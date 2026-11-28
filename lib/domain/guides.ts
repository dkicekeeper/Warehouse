/**
 * The guidelines of `standard/guides/` as the site shows them: a guide is Markdown whose rules
 * share one format, so the page can mark how each rule is checked and offer to propose a change.
 *
 *     ### DOC-1. Название правила
 *     Правило: что требуется.
 *     Почему: решение владельца (ссылка).
 *     Проверка: lint.py `tree` | аудит
 *     Где: все
 *     Агенту: да
 *
 * `standard/build_agents.py` reads the same headings and the «Коротко для агента» part; a test
 * compares the rule numbers both find.
 */

export type CheckKind = 'auto' | 'audit';

export interface GuideRule {
  id: string;
  title: string;
  text: string;
  why: string | null;
  checks: { kind: CheckKind; label: string }[];
  where: string | null;
  /** The rule goes into the block every project's CLAUDE.md carries. */
  agent: boolean;
}

export type GuideBlock = { kind: 'text'; text: string } | { kind: 'rule'; rule: GuideRule };

export interface Guide {
  slug: string;
  title: string;
  /** The first paragraph: how this part of the work is arranged, in plain words. */
  intro: string;
  /** Everything between the title and the agent part, as Markdown, for the page. */
  body: string;
  rules: GuideRule[];
  /** The body in reading order: Markdown between rules, and each rule in its place. */
  blocks: GuideBlock[];
  /** The «Коротко для агента» section without its heading. */
  agentPart: string;
}

export const RULE_HEADING = /^### ([A-Z]+-\d+)\. (.+)$/;
const AGENT_HEADING = '## Коротко для агента';
const FIELDS = { 'Правило': 'text', 'Почему': 'why', 'Проверка': 'check', 'Где': 'where', 'Агенту': 'agent' } as const;

function ruleFrom(id: string, title: string, lines: string[]): GuideRule {
  const found: Partial<Record<(typeof FIELDS)[keyof typeof FIELDS], string>> = {};
  let current: keyof typeof found | null = null;
  for (const line of lines) {
    const m = /^([А-Яа-яЁё]+): ?(.*)$/.exec(line);
    const field = m ? FIELDS[m[1] as keyof typeof FIELDS] : undefined;
    if (m && field) {
      current = field;
      found[field] = m[2] ?? '';
    } else if (current && line.trim()) {
      found[current] = `${found[current]}\n${line}`;
    } else if (!line.trim()) {
      current = null;
    }
  }
  const checks = (found.check ?? '')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((label) => ({ kind: (label === 'аудит' ? 'audit' : 'auto') as CheckKind, label }));
  return {
    id,
    title,
    text: (found.text ?? '').trim(),
    why: found.why?.trim() || null,
    checks,
    where: found.where?.trim() || null,
    agent: found.agent?.trim() === 'да',
  };
}

export function parseGuide(slug: string, markdown: string): Guide {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const titleAt = lines.findIndex((l) => l.startsWith('# '));
  const title = titleAt >= 0 ? (lines[titleAt] as string).slice(2).trim() : slug;
  const agentAt = lines.findIndex((l) => l.trim() === AGENT_HEADING);
  const bodyLines = lines.slice(titleAt + 1, agentAt >= 0 ? agentAt : lines.length);
  const agentPart = agentAt >= 0 ? lines.slice(agentAt + 1).join('\n').trim() : '';

  const rest = bodyLines.join('\n').trim();
  const intro = (rest.split(/\n\s*\n/)[0] ?? '').trim();

  const rules: GuideRule[] = [];
  const blocks: GuideBlock[] = [];
  let text: string[] = [];
  let open: { id: string; title: string; lines: string[] } | null = null;
  const flushText = () => {
    const t = text.join('\n').trim();
    if (t) blocks.push({ kind: 'text', text: t });
    text = [];
  };
  const closeRule = () => {
    if (!open) return;
    const rule = ruleFrom(open.id, open.title, open.lines);
    rules.push(rule);
    blocks.push({ kind: 'rule', rule });
    open = null;
  };
  let inCode = false;
  for (const line of bodyLines) {
    if (line.startsWith('```')) inCode = !inCode;
    const m = inCode ? null : RULE_HEADING.exec(line);
    if (m) {
      closeRule();
      flushText();
      open = { id: m[1] as string, title: (m[2] as string).trim(), lines: [] };
    } else if (!inCode && /^#{1,3} /.test(line)) {
      closeRule();
      text.push(line);
    } else if (open) {
      open.lines.push(line);
    } else {
      text.push(line);
    }
  }
  closeRule();
  flushText();

  return { slug, title, intro, body: rest, rules, blocks, agentPart };
}

const NEW_FILE = 'https://github.com/dkicekeeper/Warehouse/new/main';

/** The GitHub editor of a new idea task about a rule (or the whole guide), filled in. */
export function proposeUrl(rule: GuideRule | null, guide: Guide, today: string): string {
  const name = rule ? `guide-${rule.id.toLowerCase()}` : `guide-${guide.slug}`;
  const heading = rule ? `Правило ${rule.id} «${rule.title}»: предлагаю …` : `Гайдлайн «${guide.title}»: предлагаю …`;
  const quote = rule ? `\nСейчас: ${rule.text}\n` : '';
  const value = [
    '---',
    'status: idea',
    'type: chore',
    `created: ${today}`,
    `updated: ${today}`,
    '---',
    `# ${heading}`,
    quote,
    `Гайдлайн: standard/guides/${guide.slug}.md`,
    '',
  ].join('\n');
  const params = new URLSearchParams({ filename: `docs/backlog/${today}-${name}.md`, value });
  return `${NEW_FILE}?${params.toString()}`;
}
