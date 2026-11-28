import { describe, expect, it } from 'vitest';
import type { StoredItem } from '@/lib/domain/items';
import { formatItem, inQuietHours, planNotifications } from '@/lib/domain/notify';
import { DEFAULT_SETTINGS, type Settings } from '@/lib/domain/types';
import { minutesAgo, project } from '../helpers/factories';

const BASE = 'https://warehouse.example';
const PROJECTS = [project({ id: 'p1', name: 'Tenra' })];

/** Almaty is UTC+5 all year. */
const almaty = (hhmm: string, day = '2026-11-25') => new Date(new Date(`${day}T${hhmm}:00Z`).getTime() - 5 * 3600_000);

const NOON = almaty('12:00');
const CFG: Settings = { ...DEFAULT_SETTINGS, telegramChatId: '42', lastDigestAt: almaty('08:00') };

const item = (over: Partial<StoredItem> = {}): StoredItem => ({
  id: 'i1',
  key: 'session:session_abc',
  kind: 'session_needs_owner',
  level: 'request',
  projectId: 'p1',
  text: 'смержить PR #3',
  sessionId: 'session_abc',
  pr: null,
  repo: 'o/r',
  since: minutesAgo(10, NOON),
  status: 'open',
  firstSeenAt: minutesAgo(10, NOON),
  snoozedUntil: null,
  dismissedText: null,
  notifiedAt: null,
  notifiedText: null,
  telegramMessageId: null,
  resolvedAt: null,
  ...over,
});

const plan = (items: StoredItem[], now = NOON, cfg = CFG) => planNotifications(items, PROJECTS, now, cfg, BASE);

describe('inQuietHours', () => {
  it.each([
    ['22:59', false],
    ['23:00', true],
    ['03:00', true],
    ['07:59', true],
    ['08:00', false],
    ['12:00', false],
  ])('%s Almaty → %s', (t, expected) => {
    expect(inQuietHours(almaty(t), DEFAULT_SETTINGS)).toBe(expected);
  });

  it('handles a window that does not cross midnight', () => {
    const cfg = { ...DEFAULT_SETTINGS, quietStart: '13:00', quietEnd: '15:00' };
    expect(inQuietHours(almaty('14:00'), cfg)).toBe(true);
    expect(inQuietHours(almaty('15:00'), cfg)).toBe(false);
    expect(inQuietHours(almaty('12:59'), cfg)).toBe(false);
  });

  it('equal start and end means no quiet hours', () => {
    const cfg = { ...DEFAULT_SETTINGS, quietStart: '00:00', quietEnd: '00:00' };
    expect(inQuietHours(almaty('03:00'), cfg)).toBe(false);
  });

  it('respects the configured time zone', () => {
    const cfg = { ...DEFAULT_SETTINGS, timezone: 'UTC' };
    expect(inQuietHours(new Date('2026-11-25T23:30:00Z'), cfg)).toBe(true);
    expect(inQuietHours(new Date('2026-11-25T18:30:00Z'), cfg)).toBe(false);
  });
});

describe('formatItem', () => {
  it('shows project, text and links to the session and the board', () => {
    expect(formatItem(item(), 'Tenra', BASE)).toBe(
      '<b>Tenra</b> · смержить PR #3\n' +
        '<a href="https://claude.ai/code/session_abc">сессия</a> · <a href="https://warehouse.example">панель</a>',
    );
  });

  it('links the pull request when there is one', () => {
    const text = formatItem(item({ sessionId: null, pr: { repo: 'o/r', number: 3 } }), 'Tenra', BASE);
    expect(text).toContain('<a href="https://github.com/o/r/pull/3">PR</a>');
    expect(text).not.toContain('сессия');
  });

  it('does not link a local session, which has no web address', () => {
    expect(formatItem(item({ sessionId: '20e570d0-daba-559b-8477-09337c2e3975' }), 'Tenra', BASE)).not.toContain('claude.ai');
  });

  it('escapes HTML in the text and the project name', () => {
    const text = formatItem(item({ text: 'if a < b && c > d' }), 'R&D', BASE);
    expect(text).toContain('<b>R&amp;D</b> · if a &lt; b &amp;&amp; c &gt; d');
  });

  it('does not change with time, so an unchanged item never triggers an edit', () => {
    const a = formatItem(item({ since: minutesAgo(1, NOON) }), 'Tenra', BASE);
    const b = formatItem(item({ since: minutesAgo(900, NOON) }), 'Tenra', BASE);
    expect(a).toBe(b);
  });
});

describe('planNotifications', () => {
  it('does nothing without a bound chat', () => {
    expect(plan([item()], NOON, { ...CFG, telegramChatId: null })).toEqual({ actions: [], digestDue: false });
  });

  it('sends a needs-owner request at once', () => {
    const it1 = item();
    expect(plan([it1])).toEqual({
      actions: [{ type: 'send', itemIds: ['i1'], text: formatItem(it1, 'Tenra', BASE), digest: false }],
      digestDue: false,
    });
  });

  it('sends main_red at once', () => {
    expect(plan([item({ kind: 'main_red', firstSeenAt: NOON })]).actions).toHaveLength(1);
  });

  it('holds pr_ready and ci_failed for 5 minutes', () => {
    for (const kind of ['pr_ready', 'ci_failed'] as const) {
      expect(plan([item({ kind, firstSeenAt: minutesAgo(4, NOON) })]).actions).toEqual([]);
      expect(plan([item({ kind, firstSeenAt: minutesAgo(5, NOON) })]).actions).toHaveLength(1);
    }
  });

  it('sends each request as its own message', () => {
    const out = plan([item({ id: 'a' }), item({ id: 'b', key: 'k:b' })]);
    expect(out.actions.map((a) => a.type === 'send' && a.itemIds)).toEqual([['a'], ['b']]);
  });

  it('never sends a note on its own', () => {
    expect(plan([item({ level: 'note', kind: 'session_unknown' })]).actions).toEqual([]);
  });

  it('skips items already notified, dismissed, snoozed or resolved', () => {
    const items = [
      item({ id: 'a', notifiedAt: minutesAgo(3, NOON), notifiedText: formatItem(item(), 'Tenra', BASE), telegramMessageId: 7 }),
      item({ id: 'b', status: 'dismissed' }),
      item({ id: 'c', status: 'snoozed' }),
      item({ id: 'd', status: 'resolved' }),
    ];
    expect(plan(items).actions).toEqual([]);
  });

  it('edits the message of an item whose text changed', () => {
    const changed = item({
      text: 'смержить PR #4',
      notifiedAt: minutesAgo(30, NOON),
      notifiedText: formatItem(item(), 'Tenra', BASE),
      telegramMessageId: 7,
    });
    expect(plan([changed]).actions).toEqual([
      { type: 'edit', itemId: 'i1', messageId: 7, text: formatItem(changed, 'Tenra', BASE) },
    ]);
  });

  it('does not edit items that went out in a digest (no message of their own)', () => {
    const changed = item({ text: 'новое', notifiedAt: minutesAgo(30, NOON), notifiedText: 'старое', telegramMessageId: null });
    expect(plan([changed]).actions).toEqual([]);
  });

  it('is silent at night: no sends, no edits, no digest', () => {
    const night = almaty('03:00', '2026-11-26');
    const changed = item({ id: 'e', text: 'x', notifiedAt: minutesAgo(30, night), notifiedText: 'y', telegramMessageId: 7 });
    expect(plan([item({ firstSeenAt: minutesAgo(60, night) }), changed], night)).toEqual({ actions: [], digestDue: false });
  });

  it('the first minute after quiet hours sends one digest with the night’s requests and the notes', () => {
    const morning = almaty('08:00', '2026-11-26');
    const req = item({ id: 'r', firstSeenAt: minutesAgo(300, morning) });
    const note = item({ id: 'n', key: 'session:n', level: 'note', kind: 'session_unknown', text: 'без статуса: хвост' });
    const out = plan([req, note], morning);
    expect(out.digestDue).toBe(true);
    expect(out.actions).toHaveLength(1);
    const [a] = out.actions;
    expect(a).toMatchObject({ type: 'send', digest: true, itemIds: ['r', 'n'] });
    expect(a?.text).toContain('смержить PR #3');
    expect(a?.text).toContain('без статуса: хвост');
    expect(a?.text.indexOf('смержить PR #3')).toBeLessThan(a?.text.indexOf('без статуса: хвост') ?? -1);
  });

  it('a digest stays under Telegram’s limit: long lines are cut and the overflow is counted', () => {
    const morning = almaty('08:00', '2026-11-26');
    const notes = Array.from({ length: 60 }, (_, i) =>
      item({ id: `n${i}`, key: `session:n${i}`, level: 'note', kind: 'session_reconcile', text: `заметка ${i} ` + 'я'.repeat(590) }),
    );
    const [a] = plan(notes, morning).actions;
    expect(a?.type).toBe('send');
    expect(a?.text.length).toBeLessThanOrEqual(3900);
    expect(a?.text).toMatch(/и ещё \d+ — на панели/);
    expect(a?.text).toContain('Открыть панель');
    // Every item is covered by the digest, shown or not.
    expect(a?.type === 'send' && a.itemIds).toHaveLength(60);
    const firstLine = a?.text.split('\n').find((l) => l.startsWith('•')) ?? '';
    expect(firstLine.length).toBeLessThanOrEqual(260);
    expect(firstLine.endsWith('…')).toBe(true);
  });

  it('a digest names the requests it carries, so they can be sent alone if it fails', () => {
    const morning = almaty('08:00', '2026-11-26');
    const req = item({ id: 'r', firstSeenAt: minutesAgo(300, morning) });
    const note = item({ id: 'n', key: 'session:n', level: 'note', kind: 'session_unknown' });
    const [a] = plan([req, note], morning).actions;
    expect(a).toMatchObject({ digest: true, fallback: [{ itemId: 'r', text: formatItem(req, 'Tenra', BASE) }] });
  });

  it('once the digest is recorded, the same morning sends nothing more for those items', () => {
    const morning = almaty('08:01', '2026-11-26');
    const cfg = { ...CFG, lastDigestAt: almaty('08:00', '2026-11-26') };
    const note = item({ level: 'note', kind: 'session_unknown' });
    expect(plan([note], morning, cfg)).toEqual({ actions: [], digestDue: false });
  });

  it('a morning with nothing to say sends nothing but still counts as the digest', () => {
    expect(plan([], almaty('08:00', '2026-11-26'))).toEqual({ actions: [], digestDue: true });
  });

  it('a note that appears after the morning digest waits for the next morning', () => {
    const cfg = { ...CFG, lastDigestAt: almaty('08:00', '2026-11-26') };
    const note = item({ level: 'note', kind: 'session_silent' });
    expect(plan([note], almaty('15:00', '2026-11-26'), cfg).actions).toEqual([]);
    const next = plan([note], almaty('08:00', '2026-11-27'), cfg);
    expect(next.actions).toHaveLength(1);
    expect(next.digestDue).toBe(true);
  });

  it('a digest is due on first run, when none was ever sent', () => {
    const note = item({ level: 'note', kind: 'session_silent' });
    expect(plan([note], NOON, { ...CFG, lastDigestAt: null })).toMatchObject({ digestDue: true, actions: [{ digest: true }] });
  });

  it('the morning digest goes out for the numbers alone, under its own heading after the notes', () => {
    const morning = almaty('08:00', '2026-11-26');
    const only = planNotifications([], PROJECTS, morning, CFG, BASE, ['Tenra: 21 установка, 1 пробный, реклама $9']);
    expect(only.actions).toEqual([
      expect.objectContaining({ type: 'send', digest: true, itemIds: [], text: expect.stringContaining('<b>Цифры за вчера</b>') }),
    ]);
    expect(only.actions[0]?.type === 'send' && only.actions[0].text).toContain('• Tenra: 21 установка, 1 пробный, реклама $9');
    const note = item({ id: 'n', key: 'session:n', level: 'note', kind: 'session_unknown', text: 'без статуса: хвост' });
    const [a] = planNotifications([note], PROJECTS, morning, CFG, BASE, ['Tenra: 21 установка']).actions;
    expect(a?.type === 'send' && a.text.indexOf('хвост')).toBeLessThan(a?.type === 'send' ? a.text.indexOf('Цифры за вчера') : -1);
  });

  it('numbers do not go out outside the morning digest', () => {
    expect(planNotifications([], PROJECTS, NOON, CFG, BASE, ['Tenra: 21 установка']).actions).toEqual([]);
  });

  it('a held request is left out of the digest and goes out on its own when its delay passes', () => {
    const morning = almaty('08:00', '2026-11-26');
    const held = item({ kind: 'pr_ready', firstSeenAt: minutesAgo(2, morning) });
    expect(plan([held], morning)).toEqual({ actions: [], digestDue: true });
  });

  it('uses «Без проекта» for an item with no project', () => {
    const [a] = plan([item({ projectId: null })]).actions;
    expect(a?.text).toContain('<b>Без проекта</b>');
  });
});
