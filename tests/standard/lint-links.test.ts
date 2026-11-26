import { describe, expect, it } from 'vitest';
import { VALID, makeTree, runLint } from './tree';

const A = 'docs/architecture.md';
function lint(extra: Record<string, string>) {
  return runLint(makeTree({ ...VALID, ...extra }));
}
const clean = { code: 0, out: '' };
const page = (text: string) => ({ [A]: `# Architecture\n\n${text}\n` });

describe('lint.py: relative links', () => {
  it('reports a link to a file that is not there, with its line', () => {
    const r = lint(page('Смотри [план](missing.md).'));
    expect(r.code).toBe(1);
    expect(r.out).toContain(`${A}:3: [link]`);
    expect(r.out).toContain('missing.md');
  });

  it('accepts links to files and folders that exist', () => {
    expect(lint(page('[оглавление](README.md), [задачи](backlog/), [задача](backlog/2026-11-26-attachments.md), [корень](../CLAUDE.md)'))).toEqual(clean);
  });

  it('checks the file of a link with an anchor and skips anchors, sites and mail', () => {
    expect(lint(page('[a](README.md#раздел) [b](#здесь) [c](https://example.com/x.md) [d](mailto:a@example.com)'))).toEqual(clean);
    expect(lint(page('[a](nope.md#раздел)')).out).toContain('[link]');
  });

  it('reads links in angle brackets, with %20 and with a title', () => {
    const files = { 'docs/public/my file.md': '# f\n' };
    expect(lint({ ...files, ...page('[a](<public/my file.md>) [b](public/my%20file.md) [c](README.md "подсказка")') })).toEqual(clean);
  });

  it('skips links inside code', () => {
    expect(lint(page('`[x](nope.md)`\n\n```\n[y](nope-too.md)\n```'))).toEqual(clean);
  });

  it('does not check the archive', () => {
    expect(lint({ 'docs/archive/old.md': '[x](gone.md)\n' })).toEqual(clean);
  });

  it('checks CLAUDE.md', () => {
    expect(lint({ 'CLAUDE.md': '# Sample\n\n[нет](docs/nope.md)\n' }).out).toContain('CLAUDE.md:3: [link]');
    expect(lint({ 'CLAUDE.md': '# Sample\n\n[есть](docs/README.md)\n' })).toEqual(clean);
  });

  it('skips links that leave the repository and absolute paths', () => {
    expect(lint(page('[чужой](../../other/x.md) [корень сайта](/about)'))).toEqual(clean);
  });

  it('checks images too', () => {
    expect(lint(page('![схема](schema.png)')).out).toContain('[link]');
  });
});

describe('lint.py: files it cannot read', () => {
  it('reports a dangling symlink instead of crashing', async () => {
    const { symlinkSync } = await import('node:fs');
    const { join } = await import('node:path');
    const root = makeTree({ ...VALID, 'docs/README.md': '# Docs\narchitecture.md dangling.md\n' });
    symlinkSync('nowhere.md', join(root, 'docs', 'dangling.md'));
    const r = runLint(root);
    expect(r.out).not.toContain('Traceback');
    expect(r.code).toBe(1);
    expect(r.out).toContain('docs/dangling.md: [tree]');
  });
});
