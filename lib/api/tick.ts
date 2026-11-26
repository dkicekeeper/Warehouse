import { verifyBearer } from '@/lib/auth/bearer';
import type { GithubApp } from '@/lib/github/app';
import type { RecomputeResult } from '@/lib/recompute';
import type { Store } from '@/lib/store/store';

export interface TickDeps {
  store: Store;
  now: Date;
  token: string;
  github: GithubApp | null;
  recompute: () => Promise<RecomputeResult>;
  /** Brings the database schema up to date; returns the migrations it applied. */
  migrate: () => Promise<string[]>;
}

const MINUTE = 60_000;
const RESYNC_EVERY_MIN = 14;
const DOCS_EVERY_MIN = 30;
const EVENTS_KEPT_DAYS = 14;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Called once a minute. Recomputes every time (delayed notifications, expiring "работаю", the
 * morning digest), and about every quarter of an hour re-reads GitHub, which is what repairs any
 * webhook that never arrived.
 */
export async function handleTick(req: Request, deps: TickDeps): Promise<Response> {
  if (!verifyBearer(req, deps.token)) return new Response(null, { status: 401 });
  return runTick(deps);
}

const HEARTBEAT_EVERY_MS = 60_000;

/**
 * The tick that rides on ordinary traffic. GitHub's schedule is the intended clock, but it starts
 * late and skips beats, so every webhook, session report and open board also offers the service a
 * chance to tick — taken at most once a minute. Never throws: it runs after someone else's request.
 */
export async function tickIfDue(deps: Omit<TickDeps, 'token'>): Promise<boolean> {
  try {
    const beat = (await deps.store.getSources()).find((s) => s.source === 'heartbeat');
    if (beat?.lastOkAt && deps.now.getTime() - beat.lastOkAt.getTime() < HEARTBEAT_EVERY_MS) return false;
    await runTick(deps);
    return true;
  } catch {
    return false;
  }
}

async function runTick(deps: Omit<TickDeps, 'token'>): Promise<Response> {
  const { store, now } = deps;
  const out: { migrated?: string[]; docs?: string; resync: string; recompute: RecomputeResult | string } = {
    resync: 'skipped',
    recompute: 'not run',
  };

  // Nothing else can work on a database without its tables, so this comes first and is fatal.
  try {
    const applied = await deps.migrate();
    if (applied.length > 0) out.migrated = applied;
  } catch (err) {
    return Response.json({ migrate: message(err) }, { status: 500 });
  }
  // Marked before the work: whoever arrives in the next minute should not start a second one.
  await store.touchSource('heartbeat', now, true);

  if (!deps.github) {
    out.resync = 'not configured';
  } else {
    const last = (await store.getSources()).find((s) => s.source === 'github_resync');
    const lastAttempt = Math.max(last?.lastOkAt?.getTime() ?? 0, last?.lastErrorAt?.getTime() ?? 0);
    if (now.getTime() - lastAttempt >= RESYNC_EVERY_MIN * MINUTE) {
      try {
        const { drift } = await deps.github.resync(store, now);
        await store.adoptSessionsFromPrs();
        await store.touchSource('github_resync', now, true);
        out.resync = 'ok';
        // The first resync finds everything new; after that, finding old changes means the
        // webhooks that should have reported them never came.
        if (drift > 0 && last?.lastOkAt) {
          await store.touchSource('github_webhook', now, false, `сверка нашла изменения, о которых вебхуки не сообщили: ${drift}`);
        }
      } catch (err) {
        out.resync = message(err);
        await store.touchSource('github_resync', now, false, out.resync).catch(() => {});
      }
      try {
        const failed = await deps.github.failedDeliveriesSince(new Date(now.getTime() - 60 * MINUTE));
        if (failed > 0) {
          await store.touchSource('github_webhook', now, false, `GitHub не смог доставить вебхуков за последний час: ${failed}`);
        }
      } catch {
        /* the resync result above already tells the story */
      }
      await store.pruneEvents(new Date(now.getTime() - EVENTS_KEPT_DAYS * 1440 * MINUTE)).catch(() => {});
    }
  }

  let status = 200;
  try {
    out.recompute = await deps.recompute();
  } catch (err) {
    out.recompute = message(err);
    status = 500;
  }

  // What the repositories say about themselves (the project standard): the marked ones every
  // tick, all of them every half an hour, which also repairs a push whose webhook never came. Last,
  // because the first read of many repositories is long and nothing above may wait for it.
  if (deps.github) {
    try {
      const last = (await store.getSources()).find((s) => s.source === 'docs_sync');
      const lastAttempt = Math.max(last?.lastOkAt?.getTime() ?? 0, last?.lastErrorAt?.getTime() ?? 0);
      const all = now.getTime() - lastAttempt >= DOCS_EVERY_MIN * MINUTE;
      if (all || (await store.listDocsState()).some((r) => r.dirty)) {
        await deps.github.syncDocs(store, now, { all });
        if (all) await store.touchSource('docs_sync', now, true);
        out.docs = 'ok';
      }
    } catch (err) {
      out.docs = message(err);
      await store.touchSource('docs_sync', now, false, out.docs).catch(() => {});
    }
  }
  return Response.json(out, { status });
}
