import type { ItemKind } from './attention';
import type { StoredItem } from './items';
import type { Project, Settings } from './types';

const MINUTE = 60_000;

/** Requests that may fix themselves within minutes are held back before they reach Telegram. */
const HELD: ReadonlySet<ItemKind> = new Set(['pr_ready', 'ci_failed']);

export type NotifyAction =
  | { type: 'send'; itemIds: string[]; text: string; digest: boolean }
  | { type: 'edit'; itemId: string; messageId: number; text: string };

export interface NotifyPlan {
  actions: NotifyAction[];
  /**
   * True when this call is the morning digest moment, whether or not there was anything to send.
   * The caller records it, so that a note appearing later in the day waits for the next morning.
   */
  digestDue: boolean;
}

function minuteOfDay(now: Date, timezone: string): { minutes: number; seconds: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { minutes: get('hour') * 60 + get('minute'), seconds: get('second') };
}

function parseHHMM(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function inQuietHours(now: Date, cfg: Settings): boolean {
  const start = parseHHMM(cfg.quietStart);
  const end = parseHHMM(cfg.quietEnd);
  if (start === end) return false;
  const t = minuteOfDay(now, cfg.timezone).minutes;
  return start < end ? t >= start && t < end : t >= start || t < end;
}

/** The most recent moment quiet hours ended, at or before `now`. */
function lastQuietEnd(now: Date, cfg: Settings): Date {
  const { minutes, seconds } = minuteOfDay(now, cfg.timezone);
  const since = (minutes - parseHHMM(cfg.quietEnd) + 1440) % 1440;
  return new Date(now.getTime() - since * MINUTE - seconds * 1000 - now.getMilliseconds());
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function links(item: StoredItem, baseUrl: string): string {
  const out: string[] = [];
  if (item.sessionId?.startsWith('session_')) {
    out.push(`<a href="https://claude.ai/code/${item.sessionId}">сессия</a>`);
  }
  if (item.pr) out.push(`<a href="https://github.com/${item.pr.repo}/pull/${item.pr.number}">PR</a>`);
  out.push(`<a href="${baseUrl}">панель</a>`);
  return out.join(' · ');
}

/**
 * The Telegram text of one item (HTML mode). It deliberately carries no age: the text must stay
 * the same until the item itself changes, or every minute would look like an edit.
 */
export function formatItem(item: StoredItem, projectName: string, baseUrl: string): string {
  return `<b>${esc(projectName)}</b> · ${esc(item.text)}\n${links(item, baseUrl)}`;
}

function formatDigest(requests: StoredItem[], notes: StoredItem[], nameOf: (i: StoredItem) => string, baseUrl: string): string {
  const line = (i: StoredItem) => `• <b>${esc(nameOf(i))}</b> · ${esc(i.text)}`;
  const parts: string[] = [];
  if (requests.length > 0) parts.push(`<b>Ждёт вас: ${requests.length}</b>`, ...requests.map(line));
  if (notes.length > 0) {
    if (parts.length > 0) parts.push('');
    parts.push(`<b>Заметки: ${notes.length}</b>`, ...notes.map(line));
  }
  parts.push('', `<a href="${baseUrl}">Открыть панель</a>`);
  return parts.join('\n');
}

export function planNotifications(
  items: StoredItem[],
  projects: Project[],
  now: Date,
  cfg: Settings,
  baseUrl: string,
): NotifyPlan {
  if (cfg.telegramChatId === null || inQuietHours(now, cfg)) return { actions: [], digestDue: false };

  const names = new Map(projects.map((p) => [p.id, p.name]));
  const nameOf = (i: StoredItem) => (i.projectId ? names.get(i.projectId) : undefined) ?? 'Без проекта';
  const open = items.filter((i) => i.status === 'open');
  const pending = open.filter((i) => i.notifiedAt === null);
  const due = pending.filter(
    (i) =>
      i.level === 'request' &&
      (!HELD.has(i.kind) || now.getTime() - i.firstSeenAt.getTime() >= cfg.notifyDelayMin * MINUTE),
  );

  const actions: NotifyAction[] = [];
  for (const i of open) {
    if (i.notifiedAt === null || i.telegramMessageId === null) continue;
    const text = formatItem(i, nameOf(i), baseUrl);
    if (text !== i.notifiedText) actions.push({ type: 'edit', itemId: i.id, messageId: i.telegramMessageId, text });
  }

  const digestDue = cfg.lastDigestAt === null || cfg.lastDigestAt.getTime() < lastQuietEnd(now, cfg).getTime();
  if (digestDue) {
    const notes = pending.filter((i) => i.level === 'note');
    if (due.length + notes.length > 0) {
      actions.push({
        type: 'send',
        itemIds: [...due, ...notes].map((i) => i.id),
        text: formatDigest(due, notes, nameOf, baseUrl),
        digest: true,
      });
    }
    return { actions, digestDue: true };
  }

  for (const i of due) {
    actions.push({ type: 'send', itemIds: [i.id], text: formatItem(i, nameOf(i), baseUrl), digest: false });
  }
  return { actions, digestDue: false };
}
