import { createHmac, timingSafeEqual } from 'node:crypto';
import { applyGithubEvent } from '@/lib/ingest/github';
import type { Store } from '@/lib/store/store';

export interface GithubWebhookDeps {
  store: Store;
  now: Date;
  secret: string;
  /** Runs after the event is stored; its failure must not fail the delivery. */
  afterIngest: () => Promise<unknown>;
  /** Fetches what pull request events leave out (mergeable, the session in the commit trailers). */
  enrichPr: (repo: string, number: number) => Promise<unknown>;
}

const empty = (status: number) => new Response(null, { status });

function signatureMatches(body: string, header: string | null, secret: string): boolean {
  if (!secret || !header?.startsWith('sha256=')) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(body).digest('hex'), 'utf8');
  const given = Buffer.from(header.slice('sha256='.length), 'utf8');
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export async function handleGithubWebhook(req: Request, deps: GithubWebhookDeps): Promise<Response> {
  const body = await req.text();
  if (!signatureMatches(body, req.headers.get('x-hub-signature-256'), deps.secret)) return empty(401);

  const event = req.headers.get('x-github-event');
  const delivery = req.headers.get('x-github-delivery');
  if (!event || !delivery) return empty(400);

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return empty(400);
  }

  try {
    if ((await deps.store.recordEvent('github_webhook', delivery, payload, deps.now)) === 'duplicate') return empty(200);
    await applyGithubEvent(deps.store, event, payload, deps.now);
    await deps.store.touchSource('github_webhook', deps.now, true);
  } catch (err) {
    await deps.store
      .touchSource('github_webhook', deps.now, false, err instanceof Error ? err.message : 'ошибка обработки')
      .catch(() => {});
    return empty(500);
  }

  // Best effort from here on: the event is stored, and the minute tick repeats both steps.
  if (event === 'pull_request') {
    const p = payload as { repository?: { full_name?: unknown }; pull_request?: { number?: unknown } };
    const repo = p.repository?.full_name;
    const number = p.pull_request?.number;
    if (typeof repo === 'string' && typeof number === 'number') await deps.enrichPr(repo, number).catch(() => {});
  }
  await deps.afterIngest().catch(() => {});
  return empty(200);
}
