import { describe, expect, it } from 'vitest';
import type { TaskRow } from '@/lib/domain/backlog';
import { buildInbox, kpis, projectCards, relatedOf, type BoardResponse } from '@/lib/domain/overview';
import { BOARD } from '../e2e/fixture';

const NOW = new Date('2026-11-26T12:00:00Z');

const task = (over: Partial<TaskRow> = {}): TaskRow => ({
  id: '2026-11-20-store',
  project: 'Dalada',
  projectId: 'p-dalada',
  repo: 'dkicekeeper/Dalada',
  title: 'Скриншоты для App Store',
  status: 'blocked',
  type: 'content',
  priority: 1,
  size: 's',
  needsOwner: 'снять экран карты на телефоне',
  plan: null,
  branch: null,
  pr: null,
  updated: '2026-11-25',
  body: '',
  url: 'https://github.com/dkicekeeper/Dalada/blob/main/docs/backlog/2026-11-20-store.md',
  ...over,
});

const board: BoardResponse = {
  ...BOARD,
  backlog: {
    ownerTasks: [task()],
    byProject: {
      'p-dalada': { stage: 'live', open: 12, needsOwner: 1, inProgress: 2, ready: 3, ideas: 5 },
      'p-tenra': { stage: 'live', open: 4, needsOwner: 0, inProgress: 1, ready: 1, ideas: 2 },
    },
  },
};

describe('the inbox', () => {
  it('puts requests first, then the owner’s tasks, then the notes', () => {
    const rows = buildInbox(board, NOW);
    expect(rows.map((r) => r.level)).toEqual(['request', 'request', 'request', 'task', 'note']);
  });

  it('files sessions, PRs and tasks under their tabs', () => {
    const rows = buildInbox(board, NOW);
    expect(rows.map((r) => [r.key, r.tab])).toEqual([
      ['item:i1', 'prs'],
      ['item:i2', 'sessions'],
      ['item:i3', 'sessions'],
      ['task:dkicekeeper/Dalada/2026-11-20-store', 'tasks'],
      ['item:i4', 'sessions'],
    ]);
  });

  it('says what a task needs from the owner and how old it is', () => {
    const row = buildInbox(board, NOW).find((r) => r.tab === 'tasks');
    // A task knows only the day it was updated: its age is in whole days, not minutes.
    expect(row).toMatchObject({ project: 'Dalada', sub: 'Нужно от вас: снять экран карты на телефоне', kind: 'задача', ageMin: null, ageDays: 1 });
  });

  it('a task updated today is zero days old, and one without a readable date has no age', () => {
    const today = buildInbox({ ...board, backlog: { ownerTasks: [task({ updated: '2026-11-26' })], byProject: {} } }, NOW);
    expect(today.find((r) => r.tab === 'tasks')?.ageDays).toBe(0);
    const rows = buildInbox({ ...board, backlog: { ownerTasks: [task({ updated: 'вчера' })], byProject: {} } }, NOW);
    expect(rows.find((r) => r.tab === 'tasks')?.ageDays).toBeNull();
  });

  it('a service item carries minutes, not days', () => {
    expect(buildInbox(board, NOW)[0]).toMatchObject({ ageMin: 540, ageDays: null });
  });

  it('works without the backlog part', () => {
    expect(buildInbox({ ...board, backlog: undefined }, NOW)).toHaveLength(4);
  });
});

describe('the numbers at the top', () => {
  it('count what waits, what works and what is open', () => {
    expect(kpis(board)).toEqual({
      requests: 3,
      ownerTasks: 1,
      sessionsWorking: 1,
      sessionsSilent: 1,
      queueRunning: 2,
      queueWaiting: 3,
      freeSlotInMin: 62,
      openTasks: 16,
      inProgress: 3,
      ready: 4,
    });
  });
});

describe('project cards', () => {
  it('carry the stage, the task bar and the activity of each project', () => {
    const cards = projectCards(board);
    expect(cards.map((c) => c.name)).toEqual(['Platina', 'Tenra', 'Dalada', 'Без проекта']);
    expect(cards[0]).toMatchObject({ requests: 1, broken: false, sessions: 1, prs: 1, lastActivityMin: 70, segments: null });
    expect(cards[2]).toMatchObject({
      stage: 'live',
      openTasks: 12,
      segments: { needsOwner: 1, inProgress: 2, ready: 3, ideas: 5, other: 1 },
      lastActivityMin: null,
    });
    expect(cards[1]).toMatchObject({ sessions: 3, sessionsWorking: 1, prs: 2, lastActivityMin: 18 });
  });

  it('flag a project whose CI is red', () => {
    const red: BoardResponse = {
      ...board,
      attention: [{ ...board.attention[0]!, kind: 'ci_failed', project: 'Tenra' }],
    };
    expect(projectCards(red).find((c) => c.name === 'Tenra')?.broken).toBe(true);
  });
});

describe('what an item points at', () => {
  it('finds the PR and the session by their addresses', () => {
    const { session, pr } = relatedOf(board, board.attention[0]!);
    expect(pr?.number).toBe(3);
    expect(session?.id).toBe('session_a');
  });

  it('finds nothing for an item without links', () => {
    const { session, pr } = relatedOf(board, { ...board.attention[0]!, sessionUrl: null, prUrl: null });
    expect([session, pr]).toEqual([null, null]);
  });
});
