import type { ParsedStatus, SessionState } from './types';

const UNKNOWN_TAIL_CHARS = 300;

const STATES: [RegExp, SessionState][] = [
  [/^жд[её]т\s+владельца/iu, 'needs_owner'],
  [/^needs[\s-]owner/iu, 'needs_owner'],
  [/^работаю/iu, 'working'],
  [/^working/iu, 'working'],
  [/^готово/iu, 'done'],
  [/^done/iu, 'done'],
];

/** Markdown emphasis that models like to put around the label or the state. */
const MARK = '[*_`]*';
const LABEL = new RegExp(`^${MARK}(?:статус|status)${MARK}\\s*[:—–-][*_\`\\s]*(.*)$`, 'iu');

/**
 * Reads the status line a session ends its message with:
 * `Статус: <ждёт владельца | работаю | готово> — <one line>`.
 * It must be the last non-empty line. Anything else is `unknown`, carrying the tail of the
 * message so the owner still sees something.
 */
export function parseStatusLine(message: string): ParsedStatus {
  const lines = message.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const last = lines[lines.length - 1];
  if (last !== undefined) {
    const parsed = parseLine(last);
    if (parsed) return parsed;
  }
  return { state: 'unknown', text: tail(lines.join(' ')) };
}

function parseLine(raw: string): ParsedStatus | null {
  // Drop anything decorative before the first letter (emoji, '>', '**') and trailing markup.
  const line = raw.replace(/^[^\p{L}*_`]+/u, '').replace(/[*_`\s]+$/u, '');
  const m = LABEL.exec(line);
  if (!m) return null;
  const rest = m[1] ?? '';
  for (const [pattern, state] of STATES) {
    const sm = pattern.exec(rest);
    if (!sm) continue;
    const after = rest.slice(sm[0].length).replace(/^[*_`]+/u, '');
    // The state must be a whole word, and whatever follows must be set off from it:
    // "готово — …", "готово: …", "готово, …", "готово.", "работаю (…)". Plain prose is not a status.
    const sep = /^\s*(?:[—–:,.]|-(?=\s)|\()\s*(.*)$/u.exec(after);
    if (after.trim() !== '' && !sep) return null;
    let text = (sep?.[1] ?? '').trim();
    if (/^\s*\(/u.test(after) && text.endsWith(')')) text = text.slice(0, -1).trim();
    return { state, text };
  }
  return null;
}

function tail(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= UNKNOWN_TAIL_CHARS) return flat;
  const cut = flat.slice(flat.length - UNKNOWN_TAIL_CHARS);
  // Start on a word boundary when there is one nearby.
  const space = cut.indexOf(' ');
  return space >= 0 && space < 40 ? cut.slice(space + 1) : cut;
}
