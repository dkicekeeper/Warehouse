import type { Job, Project, PullRequest, Repo, Run, Session, Snapshot } from '@/lib/domain/types';

/** 2026-11-25 12:00 in Almaty (UTC+5). */
export const NOW = new Date('2026-11-25T07:00:00Z');

export const minutesAgo = (n: number, from: Date = NOW) => new Date(from.getTime() - n * 60_000);
export const minutesFromNow = (n: number, from: Date = NOW) => minutesAgo(-n, from);

let seq = 1000;
const next = () => ++seq;

export function session(over: Partial<Session> = {}): Session {
  return {
    id: `session_${next()}`,
    projectId: 'p1',
    repo: 'o/r',
    branch: 'claude/x',
    title: 'Сессия',
    state: 'done',
    stateText: 'сделано',
    reportedAt: minutesAgo(10),
    archived: false,
    reconcile: null,
    ...over,
  };
}

export function pr(over: Partial<PullRequest> = {}): PullRequest {
  return {
    repo: 'o/r',
    number: next(),
    title: 'Change',
    branch: 'claude/x',
    headSha: 'sha1',
    state: 'open',
    draft: false,
    mergeable: true,
    checks: 'success',
    openedAt: minutesAgo(600),
    updatedAt: minutesAgo(30),
    sessionId: null,
    ...over,
  };
}

export function run(over: Partial<Run> = {}): Run {
  return {
    id: next(),
    repo: 'o/r',
    workflow: 'CI',
    branch: 'claude/x',
    headSha: 'sha1',
    event: 'push',
    status: 'completed',
    conclusion: 'success',
    createdAt: minutesAgo(60),
    startedAt: minutesAgo(55),
    completedAt: minutesAgo(15),
    ...over,
  };
}

export function job(over: Partial<Job> = {}): Job {
  return {
    id: next(),
    runId: next(),
    repo: 'o/r',
    name: 'build-and-test',
    labels: ['xcode-27'],
    status: 'completed',
    conclusion: 'success',
    createdAt: minutesAgo(60),
    startedAt: minutesAgo(55),
    completedAt: minutesAgo(15),
    ...over,
  };
}

export const project = (over: Partial<Project> = {}): Project => ({ id: 'p1', name: 'Tenra', ...over });
export const repo = (over: Partial<Repo> = {}): Repo => ({
  fullName: 'o/r',
  projectId: 'p1',
  defaultBranch: 'main',
  ...over,
});

export function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    projects: [project()],
    repos: [repo()],
    sessions: [],
    prs: [],
    runs: [],
    jobs: [],
    ...over,
  };
}
