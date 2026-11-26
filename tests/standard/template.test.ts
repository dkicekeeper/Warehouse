import { cpSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lintJson, makeTree, runLint } from './tree';

describe('standard/template', () => {
  it('is a tree that passes the lint', () => {
    const root = makeTree({});
    cpSync(join(process.cwd(), 'standard', 'template'), root, { recursive: true });
    writeFileSync(join(root, 'CLAUDE.md'), '# New project\n');
    expect(runLint(root)).toEqual({ code: 0, out: '' });
    const { data } = lintJson(root);
    expect(data.project.stage).toBe('idea');
    expect(data.backlog).toHaveLength(1);
    expect(data.backlog[0]?.status).toBe('idea');
  });
});

describe('this repository', () => {
  it('follows its own standard', () => {
    expect(runLint(process.cwd())).toEqual({ code: 0, out: '' });
  });
});
