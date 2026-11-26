import { beforeEach, describe, expect, it } from 'vitest';
import { recompute, type Notifier } from '@/lib/recompute';
import type { PgStore } from '@/lib/store/pg';
import { testStore } from './helpers/db';
import { NOW, job, minutesAgo, minutesFromNow, pr, run, session } from './helpers/factories';

const BASE = 'https://warehouse.example';

class FakeNotifier implements Notifier {
  sent: { chatId: string; html: string }[] = [];
  edits: { messageId: number; html: string }[] = [];
  failing = false;
  private nextId = 100;
  async send(chatId: string, html: string) {
    if (this.failing) throw new Error('telegram 429: Too Many Requests');
    this.sent.push({ chatId, html });
    return { messageId: this.nextId++ };
  }
  async edit(_chatId: string, messageId: number, html: string) {
    if (this.failing) throw new Error('telegram 500');
    this.edits.push({ messageId, html });
  }
}

let store: PgStore;
let notifier: FakeNotifier;
const go = (now = NOW) => recompute(store, { now, notifier, baseUrl: BASE });

beforeEach(async () => {
  ({ store } = await testStore());
  notifier = new FakeNotifier();
  // NOW is noon in Almaty; a digest already went out this morning.
  await store.patchSettings({ telegramChatId: '42', lastDigestAt: minutesAgo(240) });
});

const asking = (over = {}) =>
  session({ projectId: null, state: 'needs_owner', stateText: 'смержить PR #3', reportedAt: minutesAgo(1), ...over });

describe('recompute', () => {
  it('a session asking for the owner becomes one item and one Telegram message', async () => {
    const s = asking();
    await store.upsertSession(s);
    const result = await go();
    expect(result).toEqual({ sent: 1, edited: 0, failed: 0 });
    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0]).toMatchObject({ chatId: '42' });
    expect(notifier.sent[0]?.html).toContain('смержить PR #3');
    const [item] = await store.loadItems();
    expect(item).toMatchObject({ key: `session:${s.id}`, status: 'open', notifiedAt: NOW, telegramMessageId: 100 });
    expect(item?.notifiedText).toBe(notifier.sent[0]?.html);
  });

  it('running again with nothing changed sends nothing', async () => {
    await store.upsertSession(asking());
    await go();
    expect(await go(minutesFromNow(1))).toEqual({ sent: 0, edited: 0, failed: 0 });
    expect(notifier.sent).toHaveLength(1);
  });

  it('a Telegram failure leaves the item un-notified, and a later run sends it exactly once', async () => {
    await store.upsertSession(asking());
    notifier.failing = true;
    expect(await go()).toEqual({ sent: 0, edited: 0, failed: 1 });
    expect((await store.loadItems())[0]?.notifiedAt).toBeNull();
    notifier.failing = false;
    // The failed attempt released its claim, so the very next minute may retry.
    expect(await go(minutesFromNow(1))).toMatchObject({ sent: 1, failed: 0 });
    expect(await go(minutesFromNow(2))).toMatchObject({ sent: 0 });
    expect(notifier.sent).toHaveLength(1);
  });

  it('one failing message does not stop the others', async () => {
    await store.upsertSession(asking());
    await store.upsertSession(asking({ stateText: 'проверить сборку 78' }));
    let calls = 0;
    const original = notifier.send.bind(notifier);
    notifier.send = async (chatId, html) => {
      if (calls++ === 0) throw new Error('telegram 500');
      return original(chatId, html);
    };
    expect(await go()).toEqual({ sent: 1, edited: 0, failed: 1 });
  });

  it('an item claimed by another worker is not sent a second time', async () => {
    await store.upsertSession(asking());
    await go();
    const [item] = await store.loadItems();
    // Simulate a sibling that took the claim but has not recorded the send yet.
    await store.patchItem(item?.id as string, { notifiedAt: null });
    expect(await store.claimNotify([item?.id as string], NOW)).toBe(true);
    expect(await go(minutesFromNow(1))).toMatchObject({ sent: 0 });
    expect(notifier.sent).toHaveLength(1);
  });

  it('when the cause goes away the item is resolved and nothing is sent', async () => {
    const s = asking();
    await store.upsertSession(s);
    await go();
    await store.upsertSession({ id: s.id, state: 'done', stateText: 'смержено', reportedAt: NOW });
    await go(minutesFromNow(1));
    expect(await store.loadItems()).toEqual([]);
    expect(notifier.sent).toHaveLength(1);
  });

  it('a changed text edits the message that was sent', async () => {
    const s = asking();
    await store.upsertSession(s);
    await go();
    await store.upsertSession({ id: s.id, stateText: 'смержить PR #4', reportedAt: NOW });
    expect(await go(minutesFromNow(1))).toEqual({ sent: 0, edited: 1, failed: 0 });
    expect(notifier.edits).toEqual([{ messageId: 100, html: expect.stringContaining('смержить PR #4') }]);
    expect(await go(minutesFromNow(2))).toMatchObject({ edited: 0 });
  });

  it('a dismissed item stays quiet until the session says something new', async () => {
    const s = asking();
    await store.upsertSession(s);
    await go();
    const [item] = await store.loadItems();
    await store.patchItem(item?.id as string, { status: 'dismissed', dismissedText: item?.text });
    await go(minutesFromNow(1));
    expect(notifier.sent).toHaveLength(1);
    await store.upsertSession({ id: s.id, stateText: 'а теперь проверить на телефоне', reportedAt: NOW });
    await go(minutesFromNow(2));
    expect(notifier.sent).toHaveLength(2);
  });

  it('a green PR waits 5 minutes before it reaches Telegram, and never does if it gets merged first', async () => {
    await store.ensureRepo('o/r', 'main', 'R');
    const p = pr({ number: 3, title: 'InfoTip' });
    await store.upsertPr(p);
    await go();
    expect(notifier.sent).toHaveLength(0);
    expect((await store.loadItems())[0]).toMatchObject({ kind: 'pr_ready', notifiedAt: null });
    await store.upsertPr({ ...p, state: 'merged' });
    await go(minutesFromNow(6));
    expect(notifier.sent).toHaveLength(0);
    expect(await store.loadItems()).toEqual([]);
  });

  it('the morning digest is recorded even when there is nothing to send', async () => {
    await store.patchSettings({ lastDigestAt: minutesAgo(30 * 60) });
    await go();
    expect(notifier.sent).toHaveLength(0);
    expect((await store.getSettings()).lastDigestAt).toEqual(NOW);
  });

  it('a digest carries the notes and marks them notified without a message of their own', async () => {
    await store.patchSettings({ lastDigestAt: minutesAgo(30 * 60) });
    await store.upsertSession(session({ projectId: null, state: 'unknown', stateText: 'хвост', reportedAt: minutesAgo(3) }));
    expect(await go()).toMatchObject({ sent: 1 });
    expect(notifier.sent[0]?.html).toContain('без статуса: хвост');
    expect((await store.loadItems())[0]).toMatchObject({ notifiedAt: NOW, telegramMessageId: null });
    expect((await store.getSettings()).lastDigestAt).toEqual(NOW);
  });

  it('a failed digest is not recorded as done', async () => {
    const before = minutesAgo(30 * 60);
    await store.patchSettings({ lastDigestAt: before });
    await store.upsertSession(session({ projectId: null, state: 'unknown', stateText: 'хвост', reportedAt: minutesAgo(3) }));
    notifier.failing = true;
    await go();
    expect((await store.getSettings()).lastDigestAt).toEqual(before);
  });

  it('without a bound chat it still keeps the items current', async () => {
    await store.patchSettings({ telegramChatId: null });
    await store.upsertSession(asking());
    expect(await go()).toEqual({ sent: 0, edited: 0, failed: 0 });
    expect(await store.loadItems()).toHaveLength(1);
  });

  it('remembers the highest number of mac jobs seen running while one waited', async () => {
    const live = { conclusion: null, completedAt: null };
    const r = run({ status: 'in_progress', ...live });
    await store.upsertRun(r);
    for (let i = 0; i < 3; i++) await store.upsertJob(job({ runId: r.id, status: 'in_progress', ...live }));
    await store.upsertJob(job({ runId: r.id, status: 'queued', startedAt: null, ...live }));
    await go();
    expect((await store.getSettings()).observedMacosLimit).toBe(3);
  });
});
