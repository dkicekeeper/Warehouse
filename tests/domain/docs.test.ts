import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { docKindOf, parseDoc, parseHeader } from '@/lib/domain/docs';
import { DECISION, PASSPORT, PLAN, TASK, VALID, lintJson, makeTree } from '../standard/tree';

const REPO = 'dkicekeeper/Sample';

describe('parseHeader', () => {
  it('reads scalars, quoted strings, numbers, booleans, lists and one nested level', () => {
    const { fields, body } = parseHeader(PASSPORT);
    expect(fields).toEqual({
      name: 'Sample', stage: 'live', kind: 'ios-app', platforms: ['ios'], standard: 1,
      links: { store: 'https://example.com/app', testflight: true },
    });
    expect(body.trim().startsWith('# Sample')).toBe(true);
  });

  it('drops comments outside quotes and keeps a colon inside them', () => {
    const { fields } = parseHeader('---\nstatus: blocked   # ждём\nneeds-owner: "цена: 5 или 7"  # к\npr: 142\ntasks: []\n---\n');
    expect(fields).toEqual({ status: 'blocked', 'needs-owner': 'цена: 5 или 7', pr: 142, tasks: [] });
  });

  it('reads a BOM and CRLF line ends', () => {
    expect(parseHeader('﻿' + TASK.replace(/\n/g, '\r\n')).fields?.status).toBe('ready');
  });

  it('says there is no header when there is none or it is never closed', () => {
    expect(parseHeader('# Just text\n').fields).toBeNull();
    expect(parseHeader('---\nstatus: ready\n# T\n').fields).toBeNull();
  });
});

describe('docKindOf', () => {
  it('knows the four kinds by their place and ignores everything else', () => {
    expect(docKindOf('docs/project.md')).toBe('project');
    expect(docKindOf('docs/backlog/2026-11-26-a.md')).toBe('task');
    expect(docKindOf('docs/plans/2026-11-26-a.md')).toBe('plan');
    expect(docKindOf('docs/decisions/2026-11-26-a.md')).toBe('decision');
    for (const path of ['docs/README.md', 'docs/archive/backlog/2026-11-26-a.md', 'docs/backlog/.gitkeep', 'docs/backlog/x/y.md', 'README.md', 'docs/plan-growth.md']) {
      expect(docKindOf(path)).toBeNull();
    }
  });
});

describe('parseDoc', () => {
  it('reads a task: id from the file name, title, status, fields and the text under the title', () => {
    const doc = parseDoc(REPO, 'docs/backlog/2026-11-26-attachments.md', 'sha1', TASK);
    expect(doc).toMatchObject({
      repo: REPO, path: 'docs/backlog/2026-11-26-attachments.md', kind: 'task', id: '2026-11-26-attachments',
      title: 'Вложения после перезапуска', status: 'ready', blobSha: 'sha1',
    });
    expect(doc?.fields).toMatchObject({ type: 'feature', priority: 2, size: 'm', created: '2026-11-26' });
    expect(doc?.body).toContain('Зачем: карточка вложения пропадает.');
    expect(doc?.body).not.toContain('# Вложения');
  });

  it('reads the passport: its status is the stage', () => {
    const doc = parseDoc(REPO, 'docs/project.md', 's', PASSPORT);
    expect(doc).toMatchObject({ kind: 'project', id: 'project', title: 'Sample', status: 'live' });
  });

  it('keeps a file without a header as a record without a status', () => {
    const doc = parseDoc(REPO, 'docs/backlog/2026-11-26-plain.md', 's', '# Просто текст\n\nАбзац.\n');
    expect(doc).toMatchObject({ kind: 'task', title: 'Просто текст', status: null, fields: {} });
  });

  it('cuts a long text', () => {
    const doc = parseDoc(REPO, 'docs/backlog/2026-11-26-long.md', 's', TASK + 'я'.repeat(5000));
    expect(doc?.body.length).toBeLessThanOrEqual(2001);
    expect(doc?.body.endsWith('…')).toBe(true);
  });

  it('returns nothing for a path that is not a record', () => {
    expect(parseDoc(REPO, 'docs/README.md', 's', '# Docs\n')).toBeNull();
  });

  it('reads the same fields as standard/lint.py', () => {
    const files: Record<string, string> = {
      ...VALID,
      'docs/backlog/2026-11-27-blocked.md': TASK.replace('status: ready', 'status: blocked   # ждём').replace('size: m', 'size: m\nneeds-owner: "выбрать цену: 5 или 7"\npr: 142'),
      'docs/decisions/2026-10-15-next.md': DECISION.replace('by: owner', 'by: claude\nsupersedes: 2026-10-14-goals-free'),
      'docs/plans/2026-11-21-empty.md': PLAN.replace('[2026-11-26-attachments]', '[]'),
    };
    const root = makeTree(files);
    const { data } = lintJson(root);
    const all = [...data.backlog, ...data.plans, ...data.decisions];
    expect(all.length).toBe(6);
    for (const record of all) {
      const mine = parseDoc(REPO, record.path, 's', readFileSync(join(root, record.path), 'utf8'));
      expect(mine?.id).toBe(record.id);
      expect(mine?.title).toBe(record.title);
      for (const [key, value] of Object.entries(record)) {
        if (['id', 'path', 'archived', 'title'].includes(key) || value === null) continue;
        expect(mine?.fields[key], `${record.path}: ${key}`).toEqual(value);
      }
    }
    const passport = parseDoc(REPO, 'docs/project.md', 's', files['docs/project.md']!);
    expect(passport?.fields).toMatchObject({ name: data.project.name, stage: data.project.stage, links: data.project.links });
  });
});
