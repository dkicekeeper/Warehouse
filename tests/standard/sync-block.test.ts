import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeTree, runSync } from './tree';

const START = '<!-- warehouse:standard:start -->';
const END = '<!-- warehouse:standard:end -->';
const OWN = '# Sample\n\nПравила проекта.\n';

function file(text: string): string {
  return join(makeTree({ 'CLAUDE.md': text }), 'CLAUDE.md');
}
const read = (path: string) => readFileSync(path, 'utf8');

describe('sync_block.py', () => {
  it('adds the block at the end of a file without markers and leaves the rest alone', () => {
    const path = file(OWN);
    expect(runSync(path).code).toBe(0);
    const text = read(path);
    expect(text.startsWith(OWN)).toBe(true);
    expect(text).toContain(START);
    expect(text.trimEnd().endsWith(END)).toBe(true);
    expect(text).toMatch(/Стандарт Warehouse, версия 1\./);
    expect(text).toContain('Статус: <состояние>');
  });

  it('replaces only the block of an older version', () => {
    const path = file(`${OWN}\n${START}\nстарый текст\n${END}\n\n## После блока\n`);
    expect(runSync(path).code).toBe(0);
    const text = read(path);
    expect(text).not.toContain('старый текст');
    expect(text.startsWith(OWN)).toBe(true);
    expect(text.endsWith('\n\n## После блока\n')).toBe(true);
  });

  it('changes nothing on a second run', () => {
    const path = file(OWN);
    runSync(path);
    const once = read(path);
    expect(runSync(path).code).toBe(0);
    expect(read(path)).toBe(once);
  });

  it('--check reports a stale file without writing it', () => {
    const path = file(OWN);
    expect(runSync(path, ['--check']).code).toBe(1);
    expect(read(path)).toBe(OWN);
    runSync(path);
    expect(runSync(path, ['--check']).code).toBe(0);
  });

  it('refuses a file with broken markers and does not touch it', () => {
    for (const text of [`${OWN}${START}\nполовина\n`, `${OWN}${END}\n`, `${OWN}${START}\na\n${END}\n${START}\nb\n${END}\n`]) {
      const path = file(text);
      const r = runSync(path);
      expect(r.code).toBe(2);
      expect(r.out).toContain('warehouse:standard');
      expect(read(path)).toBe(text);
    }
  });

  it('lowers the headings of the rules by one level', () => {
    const path = file(OWN);
    runSync(path);
    const source = readFileSync(join(process.cwd(), 'standard', 'agents.md'), 'utf8');
    const first = source.split('\n').find((line) => line.startsWith('# '))!;
    expect(read(path)).toContain(`\n#${first}\n`);
    expect(read(path)).not.toMatch(/^# Стандарт/m);
  });

  it('leaves the samples inside code fences as they are', () => {
    const path = file(OWN);
    runSync(path);
    expect(read(path)).toContain('\n---\n# Название задачи\n');
  });

  it('keeps the rules block short', () => {
    const source = readFileSync(join(process.cwd(), 'standard', 'agents.md'), 'utf8');
    expect(source.split('\n').length).toBeLessThanOrEqual(150);
    writeFileSync(join(makeTree({}), 'x'), '');
  });
});
