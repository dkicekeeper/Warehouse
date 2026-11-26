import { describe, expect, it } from 'vitest';
import { PASSPORT, VALID, makeTree, runLint } from './tree';

function lint(extra: Record<string, string | Buffer>, drop: string[] = []) {
  const files: Record<string, string | Buffer> = { ...VALID, ...extra };
  for (const path of drop) delete files[path];
  return runLint(makeTree(files));
}
const clean = { code: 0, out: '' };

describe('lint.py: the tree', () => {
  it('rejects a folder the standard does not know', () => {
    const r = lint({ 'docs/misc/notes.md': '# x\n' });
    expect(r.code).toBe(1);
    expect(r.out).toContain('docs/misc: [tree]');
  });

  it('skips a path the repository lists in docs/.standard.json', () => {
    const ignore = JSON.stringify({ ignore: [{ path: 'docs/misc', reason: 'читает скрипт' }] });
    expect(lint({ 'docs/misc/Notes_1.md': '[x](nope.md)\n', 'docs/.standard.json': ignore })).toEqual(clean);
  });

  it('reports a broken docs/.standard.json instead of crashing', () => {
    const r = lint({ 'docs/.standard.json': '{oops' });
    expect(r.code).toBe(1);
    expect(r.out).toContain('docs/.standard.json: [tree]');
  });

  it('lets archive and public hold any folders and names', () => {
    expect(lint({
      'docs/archive/planning-2026-04/Old_Plan.md': '# old\n',
      'docs/archive/icon/a.svg': '<svg/>',
      'docs/public/s/Page.Template.html': '<html>',
    })).toEqual(clean);
  });

  it('requires docs/README.md and docs/project.md', () => {
    expect(lint({}, ['docs/README.md']).out).toContain('docs/README.md: [tree]');
    expect(lint({}, ['docs/project.md']).out).toContain('docs/project.md: [tree]');
  });

  it('checks the passport fields and names the allowed values', () => {
    expect(lint({ 'docs/project.md': PASSPORT.replace('stage: live\n', '') }).out).toContain('docs/project.md: [passport]');
    const stage = lint({ 'docs/project.md': PASSPORT.replace('stage: live', 'stage: launched') });
    expect(stage.code).toBe(1);
    expect(stage.out).toContain('idea, development, beta, live, maintenance');
    expect(lint({ 'docs/project.md': PASSPORT.replace('kind: ios-app', 'kind: game') }).out).toContain('ios-app, web, library, service');
    expect(lint({ 'docs/project.md': PASSPORT.replace('standard: 1', 'standard: one') }).out).toContain('[passport]');
    expect(lint({ 'docs/project.md': '# Sample\n' }).out).toContain('docs/project.md: [passport]');
  });

  it('wants lowercase names joined by hyphens', () => {
    const r = lint({ 'docs/PLAN.md': '# p\n', 'docs/My_File.md': '# m\n', 'docs/README.md': '# Docs\n[a](architecture.md) PLAN.md My_File.md\n' });
    expect(r.out).toContain('docs/PLAN.md: [name]');
    expect(r.out).toContain('docs/My_File.md: [name]');
  });

  it('accepts version numbers in a name', () => {
    expect(lint({
      'docs/migration-8.0.md': '# m\n', 'docs/plans/2026-11-25-app-1.1-design.md': VALID['docs/plans/2026-11-20-notifications.md']!,
      'docs/README.md': '# Docs\narchitecture.md migration-8.0.md\n',
    })).toEqual(clean);
    expect(lint({ 'docs/a..b.md': '# x\n', 'docs/README.md': '# Docs\narchitecture.md a..b.md\n' }).out).toContain('[name]');
  });

  it('accepts README.md, locale codes and dotfiles', () => {
    expect(lint({
      'docs/domains/pt-BR.md': '# pt\n', 'docs/README.md': '# Docs\narchitecture.md domains/pt-BR.md\n',
      'docs/plans/.gitkeep': '', 'docs/domains/.gitkeep': '',
    })).toEqual(clean);
  });

  it('wants every flat and domain document in docs/README.md', () => {
    const r = lint({ 'docs/gotchas.md': '# g\n', 'docs/domains/map.md': '# m\n' });
    expect(r.code).toBe(1);
    expect(r.out).toContain('docs/gotchas.md: [index]');
    expect(r.out).toContain('docs/domains/map.md: [index]');
    expect(lint({
      'docs/gotchas.md': '# g\n', 'docs/domains/map.md': '# m\n',
      'docs/README.md': '# Docs\n[a](architecture.md) [g](gotchas.md) [m](domains/map.md)\n',
    })).toEqual(clean);
  });

  it('never reads what is not markdown', () => {
    expect(lint({ 'docs/public/icon.png': Buffer.from([0xff, 0xfe, 0x00, 0x81]), 'docs/data.json': Buffer.from([0xff, 0x00]) })).toEqual(clean);
  });
});
