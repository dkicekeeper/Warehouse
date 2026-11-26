import { describe, expect, it } from 'vitest';
import type { DesiredItem } from '@/lib/domain/attention';
import { dismissPatch, reconcileItems, snoozePatch, type StoredItem } from '@/lib/domain/items';
import { NOW, minutesAgo, minutesFromNow } from '../helpers/factories';

const desired = (over: Partial<DesiredItem> = {}): DesiredItem => ({
  key: 'session:s1',
  kind: 'session_needs_owner',
  level: 'request',
  projectId: 'p1',
  text: 'смержить PR #3',
  sessionId: 's1',
  pr: null,
  repo: 'o/r',
  since: minutesAgo(10),
  ...over,
});

const stored = (over: Partial<StoredItem> = {}): StoredItem => ({
  ...desired(),
  id: 'i1',
  status: 'open',
  firstSeenAt: minutesAgo(10),
  snoozedUntil: null,
  dismissedText: null,
  notifiedAt: minutesAgo(9),
  notifiedText: 'x',
  telegramMessageId: 55,
  resolvedAt: null,
  ...over,
});

const NONE = { insert: [], update: [] };

describe('reconcileItems', () => {
  it('inserts a desired item nobody has seen', () => {
    const d = desired();
    expect(reconcileItems([], [d], NOW)).toEqual({ insert: [d], update: [] });
  });

  it('resolves an open item whose cause is gone', () => {
    expect(reconcileItems([stored()], [], NOW)).toEqual({
      insert: [],
      update: [{ id: 'i1', patch: { status: 'resolved', resolvedAt: NOW } }],
    });
  });

  it('resolves snoozed and dismissed items whose cause is gone', () => {
    const items = [
      stored({ id: 'a', key: 'k:a', status: 'snoozed', snoozedUntil: minutesFromNow(60) }),
      stored({ id: 'b', key: 'k:b', status: 'dismissed', dismissedText: 'смержить PR #3' }),
    ];
    expect(reconcileItems(items, [], NOW).update.map((u) => [u.id, u.patch.status])).toEqual([
      ['a', 'resolved'],
      ['b', 'resolved'],
    ]);
  });

  it('is a no-op when nothing changed', () => {
    expect(reconcileItems([stored()], [desired()], NOW)).toEqual(NONE);
  });

  it('updates text, kind and level of an open item without touching notifiedAt', () => {
    const d = desired({ text: 'смержить PR #4', kind: 'session_silent', level: 'note' });
    expect(reconcileItems([stored()], [d], NOW)).toEqual({
      insert: [],
      update: [{ id: 'i1', patch: { text: 'смержить PR #4', kind: 'session_silent', level: 'note' } }],
    });
  });

  it('keeps a dismissed item dismissed while its text is the one that was dismissed', () => {
    const item = stored({ status: 'dismissed', dismissedText: 'смержить PR #3' });
    expect(reconcileItems([item], [desired()], NOW)).toEqual(NONE);
  });

  it('reopens a dismissed item when the source says something new', () => {
    const item = stored({ status: 'dismissed', dismissedText: 'смержить PR #3' });
    expect(reconcileItems([item], [desired({ text: 'теперь проверить сборку 78' })], NOW)).toEqual({
      insert: [],
      update: [
        {
          id: 'i1',
          patch: { status: 'open', text: 'теперь проверить сборку 78', dismissedText: null, notifiedAt: null },
        },
      ],
    });
  });

  it('leaves a snoozed item asleep until its time, but keeps its text current', () => {
    const item = stored({ status: 'snoozed', snoozedUntil: minutesFromNow(60) });
    expect(reconcileItems([item], [desired()], NOW)).toEqual(NONE);
    expect(reconcileItems([item], [desired({ text: 'новый текст' })], NOW)).toEqual({
      insert: [],
      update: [{ id: 'i1', patch: { text: 'новый текст' } }],
    });
  });

  it('wakes a snoozed item when its time has come and asks to notify again', () => {
    const item = stored({ status: 'snoozed', snoozedUntil: NOW });
    expect(reconcileItems([item], [desired()], NOW)).toEqual({
      insert: [],
      update: [{ id: 'i1', patch: { status: 'open', snoozedUntil: null, notifiedAt: null } }],
    });
  });

  it('applying its own output leaves nothing more to do', () => {
    const item = stored({ status: 'dismissed', dismissedText: 'старый' });
    const d = desired({ text: 'новый' });
    const first = reconcileItems([item], [d], NOW);
    const patched = { ...item, ...first.update[0]?.patch } as StoredItem;
    expect(reconcileItems([patched], [d], NOW)).toEqual(NONE);
  });

  it('a cause that comes back after being resolved is a new item', () => {
    // resolved items are not passed in; the store only loads the live ones
    const d = desired();
    expect(reconcileItems([], [d], NOW).insert).toEqual([d]);
  });

  it('handles several keys independently', () => {
    const keep = stored({ id: 'keep', key: 'pr:o/r#1' });
    const gone = stored({ id: 'gone', key: 'pr:o/r#2' });
    const fresh = desired({ key: 'pr:o/r#3' });
    const out = reconcileItems([keep, gone], [desired({ key: 'pr:o/r#1' }), fresh], NOW);
    expect(out.insert).toEqual([fresh]);
    expect(out.update).toEqual([{ id: 'gone', patch: { status: 'resolved', resolvedAt: NOW } }]);
  });
});

describe('owner actions', () => {
  it('dismiss remembers the text that was dismissed', () => {
    expect(dismissPatch(stored({ text: 'abc' }))).toEqual({ status: 'dismissed', dismissedText: 'abc' });
  });

  it('snooze stores the wake-up time', () => {
    const until = minutesFromNow(600);
    expect(snoozePatch(until)).toEqual({ status: 'snoozed', snoozedUntil: until });
  });
});
