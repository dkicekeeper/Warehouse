import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const STANDARD = join(process.cwd(), 'standard');

/** Builds a repository tree in a temp folder; a value is the file's text (or bytes). */
export function makeTree(files: Record<string, string | Buffer>): string {
  const root = mkdtempSync(join(tmpdir(), 'wh-std-'));
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
  return root;
}

function run(script: string, args: string[]): { code: number; out: string } {
  const r = spawnSync('python3', ['-I', join(STANDARD, script), ...args], { encoding: 'utf8' });
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
}

export function runLint(root: string, args: string[] = []): { code: number; out: string } {
  return run('lint.py', ['--root', root, ...args]);
}

/** What `lint.py --json` prints; the records carry their header fields as they are. */
export interface LintRecord { id: string; path: string; archived: boolean; title: string | null; [field: string]: unknown }
export interface LintTree {
  standard: number;
  project: { title: string | null; links: Record<string, unknown>; [field: string]: unknown };
  backlog: LintRecord[];
  plans: LintRecord[];
  decisions: LintRecord[];
  violations: { path: string; code: string; message: string }[];
}

export function lintJson(root: string): { code: number; data: LintTree } {
  const r = spawnSync('python3', ['-I', join(STANDARD, 'lint.py'), '--root', root, '--json'], { encoding: 'utf8' });
  return { code: r.status ?? -1, data: JSON.parse(r.stdout) as LintTree };
}

export function runSync(claudeMd: string, args: string[] = []): { code: number; out: string } {
  return run('sync_block.py', [claudeMd, ...args]);
}

export const TASK = `---
status: ready
type: feature
priority: 2
size: m
created: 2026-11-26
updated: 2026-11-26
---
# Вложения после перезапуска

Зачем: карточка вложения пропадает.

Готово, когда:
- вложение видно после перезапуска.
`;

export const PLAN = `---
status: approved
kind: design
created: 2026-11-20
updated: 2026-11-26
approved: 2026-11-21
tasks: [2026-11-26-attachments]
---
# Уведомления
`;

export const DECISION = `---
status: active
decided: 2026-10-14
by: owner
---
# Цели бесплатны

Решение: цели накоплений бесплатны.
Почему: так решил владелец.
`;

export const PASSPORT = `---
name: Sample
stage: live
kind: ios-app
platforms: [ios]
standard: 1
links:
  store: https://example.com/app
  testflight: true
---
# Sample

Что это: пример.
`;

/** The smallest tree that passes every check. */
export const VALID: Record<string, string> = {
  'CLAUDE.md': '# Sample\n',
  'docs/README.md': '# Docs\n\n- [architecture.md](architecture.md)\n',
  'docs/project.md': PASSPORT,
  'docs/architecture.md': '# Architecture\n',
  'docs/backlog/2026-11-26-attachments.md': TASK,
  'docs/plans/2026-11-20-notifications.md': PLAN,
  'docs/decisions/2026-10-14-goals-free.md': DECISION,
};
