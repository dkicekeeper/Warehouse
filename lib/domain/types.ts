// Shared domain types. Everything in lib/domain is pure: no network, no database, no clock
// other than the `now` passed in.

export type SessionState = 'needs_owner' | 'working' | 'done' | 'unknown';

export type ReconcileBucket = 'working' | 'blocked' | 'review_ready' | 'completed' | 'failed';

export interface Session {
  /** 'session_…' for cloud sessions, a UUID for local ones. */
  id: string;
  projectId: string | null;
  repo: string | null;
  branch: string | null;
  title: string | null;
  state: SessionState;
  stateText: string;
  /** When the Stop hook last reported. Null for sessions known only from the hourly reconcile. */
  reportedAt: Date | null;
  archived: boolean;
  reconcile: {
    bucket: ReconcileBucket;
    unread: boolean;
    summary: string | null;
    updatedAt: Date;
  } | null;
}

export type Checks = 'none' | 'pending' | 'success' | 'failure';

export interface PullRequest {
  repo: string;
  number: number;
  title: string;
  branch: string;
  headSha: string;
  state: 'open' | 'closed' | 'merged';
  draft: boolean;
  /** null: GitHub has not computed it yet. */
  mergeable: boolean | null;
  checks: Checks;
  openedAt: Date;
  updatedAt: Date;
  sessionId: string | null;
}

export type RunStatus = 'queued' | 'in_progress' | 'completed';

export interface Run {
  id: number;
  repo: string;
  workflow: string;
  branch: string;
  headSha: string;
  event: string;
  status: RunStatus;
  conclusion: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface Job {
  id: number;
  runId: number;
  repo: string;
  name: string;
  labels: string[];
  status: RunStatus;
  conclusion: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface Repo {
  fullName: string;
  projectId: string;
  defaultBranch: string;
}

export interface Project {
  id: string;
  name: string;
}

export interface Settings {
  workingTtlMin: number;
  notifyDelayMin: number;
  /** 'HH:MM' in `timezone`. The window may cross midnight. */
  quietStart: string;
  quietEnd: string;
  timezone: string;
  macosLimit: number | null;
  observedMacosLimit: number | null;
  telegramChatId: string | null;
  lastDigestAt: Date | null;
  /** One-time code that binds the owner's Telegram chat. */
  telegramLinkCode: { code: string; expiresAt: Date } | null;
  /** Set by sign-out: sessions issued before this moment are no longer accepted. */
  sessionsValidAfter: Date | null;
}

export const DEFAULT_SETTINGS: Settings = {
  workingTtlMin: 120,
  notifyDelayMin: 5,
  quietStart: '23:00',
  quietEnd: '08:00',
  timezone: 'Asia/Almaty',
  macosLimit: null,
  observedMacosLimit: null,
  telegramChatId: null,
  lastDigestAt: null,
  telegramLinkCode: null,
  sessionsValidAfter: null,
};

export interface Snapshot {
  projects: Project[];
  repos: Repo[];
  sessions: Session[];
  prs: PullRequest[];
  runs: Run[];
  jobs: Job[];
}

export interface ParsedStatus {
  state: SessionState;
  text: string;
}
