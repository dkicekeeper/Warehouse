import { describe, expect, it } from 'vitest';
import { DECISION, PLAN, TASK, VALID, makeTree, runLint } from './tree';

const T = 'docs/backlog/2026-11-26-attachments.md';
const PL = 'docs/plans/2026-11-20-notifications.md';
const D = 'docs/decisions/2026-10-14-goals-free.md';

function lint(extra: Record<string, string>, drop: string[] = []) {
  const files: Record<string, string> = { ...VALID, ...extra };
  for (const path of drop) delete files[path];
  return runLint(makeTree(files));
}
const clean = { code: 0, out: '' };
const task = (from: string, to: string) => ({ [T]: TASK.replace(from, to) });

describe('lint.py: backlog, plans, decisions', () => {
  it('names an unknown key and the keys it knows', () => {
    const r = lint(task('status: ready', 'staus: ready'));
    expect(r.code).toBe(1);
    expect(r.out).toContain(`${T}: [header]`);
    expect(r.out).toContain('staus');
    expect(r.out).toContain('status, type, priority');
  });

  it('names a wrong value and the allowed ones', () => {
    const r = lint(task('status: ready', 'status: redy'));
    expect(r.out).toContain('idea, ready, in-progress, blocked, done, dropped');
    expect(lint(task('type: feature', 'type: epic')).out).toContain('feature, bug, chore, research, content, growth');
    expect(lint(task('priority: 2', 'priority: 5')).out).toContain(`${T}: [header]`);
    expect(lint(task('size: m', 'size: xl')).out).toContain(`${T}: [header]`);
  });

  it('wants real ISO dates', () => {
    expect(lint(task('created: 2026-11-26', 'created: 2026-13-40')).out).toContain(`${T}: [header]`);
    expect(lint(task('created: 2026-11-26', 'created: вчера')).out).toContain(`${T}: [header]`);
  });

  it('wants the required fields of each status', () => {
    expect(lint(task('type: feature\n', '')).out).toContain('type');
    expect(lint(task('size: m\n', '')).out).toContain(`${T}: [header]`);
    const idea = TASK.replace('status: ready', 'status: idea').replace('priority: 2\nsize: m\n', '').replace(/Зачем[\s\S]*$/, 'Просто мысль.\n');
    expect(lint({ [T]: idea, [PL]: PLAN })).toEqual(clean);
  });

  it('wants a file with a header and a date in its name', () => {
    expect(lint({ 'docs/backlog/attachments.md': TASK }).out).toContain('docs/backlog/attachments.md: [name]');
    expect(lint({ 'docs/backlog/2026-11-27-plain.md': '# Без шапки\n' }).out).toContain('docs/backlog/2026-11-27-plain.md: [header]');
  });

  it('leaves archive files without a header alone', () => {
    expect(lint({ 'docs/archive/plans/001-ci-build.md': '# old plan\n', 'docs/archive/plans/M1-auth.md': 'текст\n' })).toEqual(clean);
  });

  it('keeps finished records in the archive and open ones out of it', () => {
    expect(lint(task('status: ready', 'status: done')).out).toContain(`${T}: [place]`);
    expect(lint({ 'docs/archive/backlog/2026-11-01-old.md': TASK }).out).toContain('docs/archive/backlog/2026-11-01-old.md: [place]');
    expect(lint({ [PL]: PLAN.replace('status: approved', 'status: dropped') }).out).toContain(`${PL}: [place]`);
    expect(lint({ [D]: DECISION.replace('status: active', 'status: superseded') }).out).toContain(`${D}: [place]`);
    expect(lint({ 'docs/archive/backlog/2026-11-01-old.md': TASK.replace('status: ready', 'status: done') })).toEqual(clean);
  });

  it('holds a ready task to the definition of ready', () => {
    expect(lint(task('Зачем: карточка вложения пропадает.\n', '')).out).toContain(`${T}: [dor]`);
    expect(lint(task('Готово, когда:', 'Когда-нибудь:')).out).toContain(`${T}: [dor]`);
    expect(lint(task('# Вложения после перезапуска\n', '')).out).toContain(`${T}: [dor]`);
    expect(lint(task('size: m', 'size: m\nneeds-owner: "выбрать цену"')).out).toContain(`${T}: [dor]`);
  });

  it('reads English sections and section headings', () => {
    const english = TASK.replace('Зачем:', 'Why:').replace('Готово, когда:', 'Done when:');
    expect(lint({ [T]: english })).toEqual(clean);
    const headings = TASK.replace('Зачем: ', '## Зачем\n\n').replace('Готово, когда:', '## Готово, когда\n');
    expect(lint({ [T]: headings })).toEqual(clean);
  });

  it('wants a reason on a blocked task', () => {
    expect(lint(task('status: ready', 'status: blocked')).out).toContain(`${T}: [dor]`);
    expect(lint(task('status: ready', 'status: blocked\nneeds-owner: "секрет"'))).toEqual(clean);
    expect(lint({ [T]: TASK.replace('status: ready', 'status: blocked') + '\nЖдёт: ответа Apple.\n' })).toEqual(clean);
  });

  it('wants a plan for a large task in progress', () => {
    const large = TASK.replace('status: ready', 'status: in-progress').replace('size: m', 'size: l');
    expect(lint({ [T]: large }).out).toContain(`${T}: [dor]`);
    expect(lint({ [T]: large.replace('size: l', 'size: l\nplan: plans/2026-11-20-notifications.md') })).toEqual(clean);
  });

  it('follows plan, tasks and supersedes to real files', () => {
    expect(lint(task('size: m', 'size: m\nplan: plans/nope.md')).out).toContain(`${T}: [ref]`);
    expect(lint({
      ...task('size: m', 'size: m\nplan: archive/plans/2026-01-01-old.md'),
      'docs/archive/plans/2026-01-01-old.md': PLAN.replace('status: approved', 'status: done').replace('tasks: [2026-11-26-attachments]', 'tasks: []'),
    })).toEqual(clean);
    expect(lint({ [PL]: PLAN.replace('[2026-11-26-attachments]', '[nope]') }).out).toContain(`${PL}: [ref]`);
    expect(lint({ [D]: DECISION.replace('by: owner', 'by: owner\nsupersedes: nope') }).out).toContain(`${D}: [ref]`);
    expect(lint({
      [D]: DECISION.replace('by: owner', 'by: owner\nsupersedes: 2026-09-01-old'),
      'docs/archive/decisions/2026-09-01-old.md': DECISION.replace('status: active', 'status: superseded'),
    })).toEqual(clean);
  });

  it('wants the approval date on an approved plan and known values on a decision', () => {
    expect(lint({ [PL]: PLAN.replace('approved: 2026-11-21\n', '') }).out).toContain(`${PL}: [header]`);
    expect(lint({ [PL]: PLAN.replace('kind: design', 'kind: spec') }).out).toContain('design, plan');
    expect(lint({ [D]: DECISION.replace('by: owner', 'by: me') }).out).toContain('owner, claude');
  });
});

describe('lint.py: findings of the branch review', () => {
  it('reports a list where one value is expected instead of crashing', () => {
    const r = lint({ [D]: DECISION.replace('by: owner', 'by: owner\nsupersedes: [x]') });
    expect(r.code).toBe(1);
    expect(r.out).toContain(`${D}: [header]`);
    expect(r.out).not.toContain('Traceback');
    const t = lint({ [T]: TASK.replace('size: m', 'size: m\nplan: [a]\nbranch: [b]') });
    expect(t.out).toContain(`${T}: [header]`);
    expect(t.out).not.toContain('Traceback');
    const p = lint({ [PL]: PLAN.replace('[2026-11-26-attachments]', '[[a]]') });
    expect(p.out).not.toContain('Traceback');
  });

  it('finds the plan of an archived task after the plan moved to the archive too', () => {
    expect(lint({
      'docs/archive/backlog/2026-11-01-old.md': TASK.replace('status: ready', 'status: done').replace('size: m', 'size: m\nplan: plans/2026-01-01-old.md'),
      'docs/archive/plans/2026-01-01-old.md': PLAN.replace('status: approved', 'status: done').replace('tasks: [2026-11-26-attachments]', 'tasks: [2026-11-01-old]'),
    })).toEqual(clean);
  });
});
