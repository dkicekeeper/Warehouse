import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { handleGithubWebhook } from '@/lib/api/github-webhook';
import type { PgStore } from '@/lib/store/pg';
import { testStore } from '../helpers/db';
import { NOW } from '../helpers/factories';
import { pullRequestEvent } from '../fixtures/github';

const SECRET = 'whsec_test';
const REPO = 'dkicekeeper/Platina';

let store: PgStore;
let after: number;
let enriched: string[];
beforeEach(async () => {
  ({ store } = await testStore());
  after = 0;
  enriched = [];
});

const sign = (body: string, secret = SECRET) => 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

function request(payload: unknown, o: { event?: string; delivery?: string | null; signature?: string | null } = {}) {
  const body = JSON.stringify(payload);
  const headers = new Headers({ 'content-type': 'application/json', 'x-github-event': o.event ?? 'pull_request' });
  if (o.delivery !== null) headers.set('x-github-delivery', o.delivery ?? 'd-1');
  if (o.signature !== null) headers.set('x-hub-signature-256', o.signature ?? sign(body));
  return new Request('https://w.example/api/github/webhook', { method: 'POST', headers, body });
}

const handle = (req: Request, over: Partial<Parameters<typeof handleGithubWebhook>[1]> = {}) =>
  handleGithubWebhook(req, {
    store,
    now: NOW,
    secret: SECRET,
    afterIngest: async () => {
      after++;
    },
    enrichPr: async (repo, number) => {
      enriched.push(`${repo}#${number}`);
    },
    ...over,
  });

describe('GitHub webhook', () => {
  it('applies a signed delivery, marks the source healthy and triggers a recompute', async () => {
    const res = await handle(request(pullRequestEvent('opened')));
    expect(res.status).toBe(200);
    expect(await store.getPr(REPO, 3)).toMatchObject({ state: 'open' });
    expect(after).toBe(1);
    expect(await store.getSources()).toMatchObject([{ source: 'github_webhook', lastOkAt: NOW }]);
  });

  it('asks for the details GitHub leaves out of pull request events', async () => {
    await handle(request(pullRequestEvent('opened')));
    expect(enriched).toEqual([`${REPO}#3`]);
  });

  it('does not ask for details on events about other things', async () => {
    await handle(request({ zen: 'x' }, { event: 'ping' }));
    expect(enriched).toEqual([]);
  });

  it.each([
    ['a wrong signature', { signature: 'sha256=' + '0'.repeat(64) }],
    ['a signature made with another secret', { signature: sign(JSON.stringify(pullRequestEvent('opened')), 'other') }],
    ['no signature', { signature: null }],
    ['a malformed signature', { signature: 'nonsense' }],
  ])('rejects %s with an empty 401 and stores nothing', async (_name, o) => {
    const res = await handle(request(pullRequestEvent('opened'), o));
    expect(res.status).toBe(401);
    expect(await res.text()).toBe('');
    expect(await store.getPr(REPO, 3)).toBeNull();
    expect(await store.getSources()).toEqual([]);
    expect(after).toBe(0);
  });

  it('rejects everything when no secret is configured', async () => {
    const res = await handle(request(pullRequestEvent('opened')), { secret: '' });
    expect(res.status).toBe(401);
    expect(await store.getPr(REPO, 3)).toBeNull();
  });

  it('answers 200 to a repeated delivery without applying it again', async () => {
    await handle(request(pullRequestEvent('opened')));
    const stored = await store.getPr(REPO, 3);
    await store.upsertPr({ ...stored!, title: 'changed since' });
    const res = await handle(request(pullRequestEvent('opened')));
    expect(res.status).toBe(200);
    expect((await store.getPr(REPO, 3))?.title).toBe('changed since');
    expect(after).toBe(1);
  });

  it('rejects a delivery without an id or an event name', async () => {
    expect((await handle(request(pullRequestEvent('opened'), { delivery: null }))).status).toBe(400);
  });

  it('answers 400 to a body that is not JSON, after checking the signature', async () => {
    const body = 'not json';
    const req = new Request('https://w.example/api/github/webhook', {
      method: 'POST',
      headers: { 'x-github-event': 'push', 'x-github-delivery': 'd-9', 'x-hub-signature-256': sign(body) },
      body,
    });
    expect((await handle(req)).status).toBe(400);
  });

  it('a failing recompute does not fail the delivery: the data is stored and the tick will catch up', async () => {
    const res = await handle(request(pullRequestEvent('opened')), {
      afterIngest: async () => {
        throw new Error('telegram down');
      },
    });
    expect(res.status).toBe(200);
    expect(await store.getPr(REPO, 3)).not.toBeNull();
  });

  it('a failure to store answers 500 and marks the source unhealthy', async () => {
    const broken = Object.create(store) as PgStore;
    broken.upsertPr = async () => {
      throw new Error('db down');
    };
    const res = await handle(request(pullRequestEvent('opened')), { store: broken });
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('');
    expect((await store.getSources())[0]).toMatchObject({ source: 'github_webhook', lastOkAt: null, note: 'db down' });
  });
});
