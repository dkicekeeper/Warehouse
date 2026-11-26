import { describe, expect, it } from 'vitest';
import { PASSPORT, TASK, VALID, lintJson, makeTree, runLint } from './tree';

describe('lint.py: reading a tree', () => {
  it('passes the valid tree and returns it as JSON', () => {
    const root = makeTree(VALID);
    expect(runLint(root)).toEqual({ code: 0, out: '' });
    const { code, data } = lintJson(root);
    expect(code).toBe(0);
    expect(data.standard).toBe(1);
    expect(data.project).toMatchObject({ name: 'Sample', stage: 'live', kind: 'ios-app', platforms: ['ios'], standard: 1, title: 'Sample' });
    expect(data.project.links).toEqual({ store: 'https://example.com/app', testflight: true });
    expect(data.backlog).toHaveLength(1);
    expect(data.backlog[0]).toMatchObject({
      id: '2026-11-26-attachments', path: 'docs/backlog/2026-11-26-attachments.md', archived: false,
      title: 'Вложения после перезапуска', status: 'ready', type: 'feature', priority: 2, size: 'm',
      created: '2026-11-26', 'needs-owner': null, plan: null, branch: null, pr: null,
    });
    expect(data.plans[0]).toMatchObject({ id: '2026-11-20-notifications', kind: 'design', approved: '2026-11-21', tasks: ['2026-11-26-attachments'] });
    expect(data.decisions[0]).toMatchObject({ id: '2026-10-14-goals-free', status: 'active', by: 'owner', supersedes: null });
    expect(data.violations).toEqual([]);
  });

  it('marks records under docs/archive as archived', () => {
    const done = TASK.replace('status: ready', 'status: done');
    const root = makeTree({ ...VALID, 'docs/archive/backlog/2026-11-01-old.md': done });
    const { data } = lintJson(root);
    expect(data.backlog.find((t) => t.id === '2026-11-01-old')?.archived).toBe(true);
  });

  it('reads a header with a BOM and CRLF line ends', () => {
    const root = makeTree({ ...VALID, 'docs/backlog/2026-11-26-attachments.md': '﻿' + TASK.replace(/\n/g, '\r\n') });
    const { code, data } = lintJson(root);
    expect(code).toBe(0);
    expect(data.backlog[0]).toMatchObject({ status: 'ready', title: 'Вложения после перезапуска' });
  });

  it('reads quoted strings, comments, lists and nothing in a list', () => {
    const task = TASK.replace('status: ready', 'status: blocked   # ждём').replace('size: m', 'size: m\nneeds-owner: "выбрать цену: 5 или 7"  # комментарий\npr: 142');
    const plan = VALID['docs/plans/2026-11-20-notifications.md']!.replace('tasks: [2026-11-26-attachments]', 'tasks: []');
    const root = makeTree({ ...VALID, 'docs/backlog/2026-11-26-attachments.md': task, 'docs/plans/2026-11-20-notifications.md': plan });
    const { data } = lintJson(root);
    expect(data.backlog[0]).toMatchObject({ status: 'blocked', 'needs-owner': 'выбрать цену: 5 или 7', pr: 142 });
    expect(data.plans[0]?.tasks).toEqual([]);
  });

  it('reports a header that is never closed', () => {
    const root = makeTree({ ...VALID, 'docs/backlog/2026-11-26-attachments.md': '---\nstatus: ready\n# Заголовок\n' });
    const r = runLint(root);
    expect(r.code).toBe(1);
    expect(r.out).toContain('docs/backlog/2026-11-26-attachments.md: [header]');
  });

  it('exits with 2 when there is no docs folder', () => {
    const root = makeTree({ 'CLAUDE.md': '# x\n' });
    const r = runLint(root);
    expect(r.code).toBe(2);
    expect(r.out).toContain('docs');
  });

  it('keeps the passport fields it cannot find as null', () => {
    const root = makeTree({ ...VALID, 'docs/project.md': PASSPORT.replace('links:\n  store: https://example.com/app\n  testflight: true\n', '') });
    expect(lintJson(root).data.project.links).toEqual({});
  });
});
