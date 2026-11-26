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
  // Drop markdown wrapping and anything decorative before the first letter (emoji, '>', '**').
  const line = raw.replace(/^[^\p{L}]+/u, '').replace(/[*_`\s]+$/u, '');
  const m = /^(?:статус|status)\s*:\s*(.*)$/iu.exec(line);
  if (!m) return null;
  const rest = m[1] ?? '';
  for (const [pattern, state] of STATES) {
    const sm = pattern.exec(rest);
    if (!sm) continue;
    const after = rest.slice(sm[0].length);
    if (after.trim() === '') return { state, text: '' };
    const sep = /^\s*[—–-]\s*(.*)$/u.exec(after);
    if (!sep) return null;
    return { state, text: (sep[1] ?? '').trim() };
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
