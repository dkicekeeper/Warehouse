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
}

const MINUTE = 60_000;
const RESYNC_EVERY_MIN = 14;
const EVENTS_KEPT_DAYS = 14;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Called once a minute. Recomputes every time (delayed notifications, expiring "работаю", the
 * morning digest), and about every quarter of an hour re-reads GitHub, which is what repairs any
 * webhook that never arrived.
 */
export async function handleTick(req: Request, deps: TickDeps): Promise<Response> {
  if (!verifyBearer(req, deps.token)) return new Response(null, { status: 401 });
  const { store, now } = deps;
  const out: { resync: string; recompute: RecomputeResult | string } = { resync: 'skipped', recompute: 'not run' };

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
  return Response.json(out, { status });
}
