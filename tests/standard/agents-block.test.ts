import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseGuide } from '@/lib/domain/guides';

const STANDARD = join(process.cwd(), 'standard');
const GUIDES = join(STANDARD, 'guides');
const build = (...args: string[]) =>
  spawnSync('python3', ['-I', join(STANDARD, 'build_agents.py'), ...args], { encoding: 'utf8' });

const block = readFileSync(join(STANDARD, 'agents.md'), 'utf8');
const guides = readdirSync(GUIDES)
  .filter((f) => f.endsWith('.md') && f !== 'README.md')
  .map((f) => parseGuide(f.replace(/\.md$/, ''), readFileSync(join(GUIDES, f), 'utf8')));
const allIds = guides.flatMap((g) => g.rules.map((r) => r.id));

describe('standard/build_agents.py', () => {
  it('agents.md in the repository is what the guides give', () => {
    const r = build('--check');
    expect(r.stdout + r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  it('--check fails and says what to run when a guide changed after the block was built', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wh-guides-'));
    cpSync(GUIDES, join(dir, 'guides'), { recursive: true });
    const out = join(dir, 'agents.md');
    expect(build('--guides', join(dir, 'guides'), '--out', out).status).toBe(0);
    const docs = join(dir, 'guides', 'docs.md');
    writeFileSync(docs, readFileSync(docs, 'utf8').replace('(DOC-2)', '(DOC-2), и ещё строка'));
    const r = build('--guides', join(dir, 'guides'), '--out', out, '--check');
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('build_agents.py');
  });

  it('names only rules that exist, and every rule meant for the agent', () => {
    const named = [...block.matchAll(/\b([A-Z]{2,3}-\d+)\b/g)].map((m) => m[1]!);
    for (const id of named) expect(allIds, id).toContain(id);
    for (const g of guides) for (const r of g.rules.filter((x) => x.agent)) expect(named, r.id).toContain(r.id);
  });

  it('stays within 200 lines and keeps the formats and the status line', () => {
    expect(block.split('\n').length).toBeLessThanOrEqual(200);
    expect(block).toContain('status: ready        # idea | ready | in-progress | blocked | done | dropped');
    expect(block).toContain('`Статус: <состояние> — <одна строка>`');
    expect(block).toContain('https://github.com/dkicekeeper/Warehouse/tree/main/standard/guides');
  });

  it('finds the same rule numbers as the site parser', () => {
    const r = build('--ids');
    expect(r.stdout.trim().split('\n')).toEqual(allIds.slice().sort());
  });
});
