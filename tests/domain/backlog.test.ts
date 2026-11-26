import { describe, expect, it } from 'vitest';
import { buildBacklogView, summarizeBacklog } from '@/lib/domain/backlog';
import type { ProjectDoc } from '@/lib/domain/docs';
import type { Project, Repo } from '@/lib/domain/types';
import { NOW } from '../helpers/factories';

const projects: Project[] = [{ id: 'p1', name: 'Platina' }, { id: 'p2', name: 'Tenra' }, { id: 'p3', name: 'Пустой' }];
const repos: Repo[] = [
  { fullName: 'o/Platina', projectId: 'p1', defaultBranch: 'main' },
  { fullName: 'o/Tenra', projectId: 'p2', defaultBranch: 'trunk' },
];
let n = 0;
const task = (repo: string, status: string | null, fields: Record<string, unknown> = {}, over: Partial<ProjectDoc> = {}): ProjectDoc => {
  const id = `2026-11-26-t${++n}`;
  return { repo, path: `docs/backlog/${id}.md`, kind: 'task', id, title: `Задача ${n}`, status, fields: { status, ...fields }, body: 'Зачем: надо.', blobSha: 's', ...over };
};
const passport: ProjectDoc = {
  repo: 'o/Platina', path: 'docs/project.md', kind: 'project', id: 'project', title: 'Platina', status: 'beta',
  fields: { name: 'Platina', stage: 'beta', kind: 'ios-app', platforms: ['ios'], links: { site: 'https://x', testflight: true } },
  body: 'Трекер трофеев.', blobSha: 's',
};

describe('buildBacklogView', () => {
  it('groups records by project, with the passport and counts', () => {
    const docs = [
      passport,
      task('o/Platina', 'blocked', { 'needs-owner': 'проверить на iPhone', priority: 1 }),
      task('o/Platina', 'in-progress', { priority: 2, branch: 'claude/x', pr: 9 }),
      task('o/Platina', 'ready', { priority: 2, type: 'bug', size: 's' }),
      task('o/Platina', 'idea', { priority: 3 }),
      task('o/Tenra', 'idea'),
    ];
    const view = buildBacklogView(projects, repos, docs, NOW);
    expect(view.projects.map((p) => p.name)).toEqual(['Platina', 'Tenra']);
    const platina = view.projects[0]!;
    expect(platina.passport).toMatchObject({ stage: 'beta', kind: 'ios-app', title: 'Platina', about: 'Трекер трофеев.', links: { site: 'https://x', testflight: true } });
    expect(platina.counts).toEqual({ open: 4, needsOwner: 1, inProgress: 1, ready: 1, ideas: 1 });
    expect(view.projects[1]!.passport).toBeNull();
    expect(view.generatedAt).toBe(NOW.toISOString());
  });

  it('orders tasks: waiting for the owner, in progress, ready, blocked, ideas; then by priority', () => {
    const docs = [
      task('o/Platina', 'idea', { priority: 3 }, { title: 'идея' }),
      task('o/Platina', 'ready', { priority: 2 }, { title: 'готова 2' }),
      task('o/Platina', 'blocked', {}, { title: 'заблокирована' }),
      task('o/Platina', 'ready', { priority: 1 }, { title: 'готова 1' }),
      task('o/Platina', 'in-progress', {}, { title: 'в работе' }),
      task('o/Platina', 'blocked', { 'needs-owner': 'секрет' }, { title: 'ждёт' }),
      task('o/Platina', null, {}, { title: 'без статуса' }),
    ];
    const titles = buildBacklogView(projects, repos, docs, NOW).projects[0]!.tasks.map((t) => t.title);
    expect(titles).toEqual(['ждёт', 'в работе', 'готова 1', 'готова 2', 'заблокирована', 'идея', 'без статуса']);
  });

  it('gives each row what the page shows and a link to the file on its default branch', () => {
    const docs = [task('o/Tenra', 'blocked', { 'needs-owner': 'ключ', priority: 1, type: 'chore', size: 's', plan: 'plans/p.md', updated: '2026-11-26' })];
    const row = buildBacklogView(projects, repos, docs, NOW).projects[0]!.tasks[0]!;
    expect(row).toMatchObject({
      project: 'Tenra', repo: 'o/Tenra', status: 'blocked', needsOwner: 'ключ', priority: 1, type: 'chore', size: 's',
      plan: 'plans/p.md', updated: '2026-11-26', body: 'Зачем: надо.',
    });
    expect(row.url).toBe(`https://github.com/o/Tenra/blob/trunk/docs/backlog/${row.id}.md`);
  });

  it('lists plans and decisions, newest first', () => {
    const plan = (id: string, status: string): ProjectDoc => ({ repo: 'o/Platina', path: `docs/plans/${id}.md`, kind: 'plan', id, title: id, status, fields: { status, kind: 'design', approved: '2026-11-25', tasks: ['a'] }, body: '', blobSha: 's' });
    const dec = (id: string): ProjectDoc => ({ repo: 'o/Platina', path: `docs/decisions/${id}.md`, kind: 'decision', id, title: id, status: 'active', fields: { decided: id.slice(0, 10), by: 'owner' }, body: 'Решение: да.', blobSha: 's' });
    const p = buildBacklogView(projects, repos, [plan('2026-11-20-a', 'approved'), plan('2026-11-25-b', 'in-progress'), dec('2026-10-01-x'), dec('2026-11-01-y')], NOW).projects[0]!;
    expect(p.plans.map((x) => x.id)).toEqual(['2026-11-25-b', '2026-11-20-a']);
    expect(p.plans[0]).toMatchObject({ status: 'in-progress', kind: 'design', approved: '2026-11-25', tasks: ['a'] });
    expect(p.decisions.map((x) => x.id)).toEqual(['2026-11-01-y', '2026-10-01-x']);
    expect(p.decisions[0]).toMatchObject({ decided: '2026-11-01', by: 'owner', body: 'Решение: да.' });
  });

  it('collects what waits for the owner across projects, most urgent first', () => {
    const docs = [
      task('o/Tenra', 'blocked', { 'needs-owner': 'токен', priority: 2 }, { title: 'токен' }),
      task('o/Platina', 'blocked', { 'needs-owner': 'iPhone', priority: 1 }, { title: 'iPhone' }),
      task('o/Platina', 'blocked', {}, { title: 'не к владельцу' }),
      task('o/Platina', 'ready', { 'needs-owner': 'странно' }, { title: 'готова с вопросом' }),
    ];
    const view = buildBacklogView(projects, repos, docs, NOW);
    expect(view.ownerTasks.map((t) => [t.project, t.title])).toEqual([['Platina', 'iPhone'], ['Tenra', 'токен'], ['Platina', 'готова с вопросом']]);
  });

  it('ignores records of repositories it does not know and survives odd fields', () => {
    const docs = [task('o/Unknown', 'ready'), task('o/Platina', 'ready', { priority: 'high', 'needs-owner': ['a'], pr: 'x' })];
    const view = buildBacklogView(projects, repos, docs, NOW);
    expect(view.projects).toHaveLength(1);
    expect(view.projects[0]!.tasks[0]).toMatchObject({ priority: null, needsOwner: null, pr: null });
  });
});

describe('summarizeBacklog', () => {
  it('keeps what the board needs: tasks for the owner, and the stage and counts of each project', () => {
    const view = buildBacklogView(projects, repos, [passport, task('o/Platina', 'blocked', { 'needs-owner': 'iPhone' })], NOW);
    const s = summarizeBacklog(view);
    expect(s.ownerTasks).toHaveLength(1);
    expect(s.byProject).toEqual({ p1: { stage: 'beta', open: 1, needsOwner: 1, inProgress: 0, ready: 0, ideas: 0 } });
  });
});
