/**
 * The records of the project standard as the service reads them from a repository: the passport
 * (`docs/project.md`), tasks (`docs/backlog/`), plans (`docs/plans/`) and decisions
 * (`docs/decisions/`). The header format is the one `standard/lint.py` checks; a test compares
 * the two readers on the same files.
 */

export type DocKind = 'project' | 'task' | 'plan' | 'decision';

export interface ProjectDoc {
  repo: string;
  path: string;
  kind: DocKind;
  /** The file's name without `.md`; `project` for the passport. */
  id: string;
  title: string | null;
  /** A task's, plan's or decision's `status`; the passport's `stage`. */
  status: string | null;
  fields: Record<string, unknown>;
  /** The text under the title, cut to BODY_LIMIT. */
  body: string;
  blobSha: string;
}

export const BODY_LIMIT = 2000;

const FOLDERS: Record<string, DocKind> = { backlog: 'task', plans: 'plan', decisions: 'decision' };

export function docKindOf(path: string): DocKind | null {
  if (path === 'docs/project.md') return 'project';
  const match = /^docs\/(backlog|plans|decisions)\/[^/]+\.md$/.exec(path);
  return match ? (FOLDERS[match[1] as string] ?? null) : null;
}

function stripComment(value: string): string {
  let quote: string | null = null;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i] as string;
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#' && (i === 0 || value[i - 1] === ' ' || value[i - 1] === '\t')) {
      return value.slice(0, i);
    }
  }
  return value;
}

function scalar(raw: string): unknown {
  const text = raw.trim();
  const first = text[0];
  if (text.length >= 2 && first === text[text.length - 1] && (first === '"' || first === "'")) return text.slice(1, -1);
  if (text === 'true' || text === 'false') return text === 'true';
  if (/^-?\d+$/.test(text)) return Number(text);
  return text;
}

function value(raw: string): unknown {
  const text = stripComment(raw).trim();
  if (text.startsWith('[') && text.endsWith(']')) {
    const inner = text.slice(1, -1).trim();
    return inner ? inner.split(',').filter((part) => part.trim()).map(scalar) : [];
  }
  return scalar(text);
}

/** The header's fields (null when the file has no closed header) and the text after it. */
export function parseHeader(text: string): { fields: Record<string, unknown> | null; body: string } {
  const clean = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = clean.split('\n');
  if (lines[0]?.trim() !== '---') return { fields: null, body: clean };
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
  if (end < 0) return { fields: null, body: clean };
  const fields: Record<string, unknown> = {};
  let parent: string | null = null;
  for (const line of lines.slice(1, end)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const match = /^(\s*)([A-Za-z][A-Za-z0-9_-]*):(.*)$/.exec(line);
    if (!match) continue;
    const [, indent, key, raw] = match as unknown as [string, string, string, string];
    if (indent) {
      const holder = parent ? fields[parent] : null;
      if (holder && typeof holder === 'object' && !Array.isArray(holder)) (holder as Record<string, unknown>)[key] = value(raw);
      continue;
    }
    if (!stripComment(raw).trim()) {
      fields[key] = {};
      parent = key;
    } else {
      fields[key] = value(raw);
      parent = null;
    }
  }
  return { fields, body: lines.slice(end + 1).join('\n') };
}

/** The first `# ` heading outside code fences, and the text without that line. */
function splitTitle(body: string): { title: string | null; rest: string } {
  const lines = body.split('\n');
  let inCode = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line.startsWith('```')) inCode = !inCode;
    else if (!inCode && line.startsWith('# ')) {
      return { title: line.slice(2).trim(), rest: [...lines.slice(0, i), ...lines.slice(i + 1)].join('\n') };
    }
  }
  return { title: null, rest: body };
}

/** What Postgres cannot keep in text or JSON: NUL, and half of a character that needs two units. */
const UNSTORABLE = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function parseDoc(repo: string, path: string, blobSha: string, raw: string): ProjectDoc | null {
  const kind = docKindOf(path);
  if (!kind) return null;
  const { fields, body } = parseHeader(raw.replace(UNSTORABLE, ''));
  const { title, rest } = splitTitle(body);
  const trimmed = rest.trim();
  const statusKey = kind === 'project' ? 'stage' : 'status';
  const status = fields?.[statusKey];
  return {
    repo,
    path,
    kind,
    id: kind === 'project' ? 'project' : (path.split('/').pop() as string).replace(/\.md$/, ''),
    title,
    status: typeof status === 'string' ? status : null,
    fields: fields ?? {},
    body: trimmed.length > BODY_LIMIT ? `${Array.from(trimmed).slice(0, BODY_LIMIT).join('')}…` : trimmed,
    blobSha,
  };
}
