import type { ProjectDoc } from './docs';
import type { Project, Repo } from './types';

/**
 * What the projects say about themselves by the project standard, arranged for the pages: tasks,
 * plans and decisions by project, and across projects the tasks that wait for the owner.
 */

export interface TaskRow {
  id: string;
  project: string;
  projectId: string;
  repo: string;
  title: string;
  status: string | null;
  type: string | null;
  priority: number | null;
  size: string | null;
  /** What the owner has to do; null when the task does not wait for the owner. */
  needsOwner: string | null;
  plan: string | null;
  branch: string | null;
  pr: number | null;
  updated: string | null;
  body: string;
  url: string;
}

export interface PlanRow {
  id: string;
  title: string;
  status: string | null;
  kind: string | null;
  approved: string | null;
  tasks: string[];
  url: string;
}

export interface DecisionRow {
  id: string;
  title: string;
  decided: string | null;
  by: string | null;
  body: string;
  url: string;
}

export interface Passport {
  title: string | null;
  stage: string | null;
  kind: string | null;
  platforms: string[];
  links: Record<string, string | boolean>;
  about: string;
}

export interface BacklogCounts {
  open: number;
  needsOwner: number;
  inProgress: number;
  ready: number;
  ideas: number;
}

export interface ProjectBacklog {
  id: string;
  name: string;
  repos: string[];
  passport: Passport | null;
  counts: BacklogCounts;
  tasks: TaskRow[];
  plans: PlanRow[];
  decisions: DecisionRow[];
}

export interface BacklogView {
  generatedAt: string;
  projects: ProjectBacklog[];
  ownerTasks: TaskRow[];
}

export interface BacklogSummary {
  ownerTasks: TaskRow[];
  byProject: Record<string, BacklogCounts & { stage: string | null }>;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Lower comes first: what waits for the owner, then work in hand, then what can be taken. */
function rank(t: TaskRow): number {
  if (t.needsOwner) return 0;
  switch (t.status) {
    case 'in-progress':
      return 1;
    case 'ready':
      return 2;
    case 'blocked':
      return 3;
    case 'idea':
      return 4;
    default:
      return 5;
  }
}

const byUrgency = (a: TaskRow, b: TaskRow) =>
  rank(a) - rank(b) || (a.priority ?? 9) - (b.priority ?? 9) || a.id.localeCompare(b.id);

export function buildBacklogView(projects: Project[], repos: Repo[], docs: ProjectDoc[], now: Date): BacklogView {
  const repoOf = new Map(repos.map((r) => [r.fullName, r]));
  const nameOf = new Map(projects.map((p) => [p.id, p.name]));
  const byProject = new Map<string, ProjectBacklog>();

  for (const doc of docs) {
    const repo = repoOf.get(doc.repo);
    if (!repo) continue;
    let p = byProject.get(repo.projectId);
    if (!p) {
      p = {
        id: repo.projectId,
        name: nameOf.get(repo.projectId) ?? doc.repo,
        repos: repos.filter((r) => r.projectId === repo.projectId).map((r) => r.fullName),
        passport: null,
        counts: { open: 0, needsOwner: 0, inProgress: 0, ready: 0, ideas: 0 },
        tasks: [],
        plans: [],
        decisions: [],
      };
      byProject.set(repo.projectId, p);
    }
    const url = `https://github.com/${doc.repo}/blob/${repo.defaultBranch}/${doc.path}`;
    const f = doc.fields;
    if (doc.kind === 'project') {
      const links: Record<string, string | boolean> = {};
      if (f.links && typeof f.links === 'object' && !Array.isArray(f.links)) {
        for (const [k, v] of Object.entries(f.links)) if (typeof v === 'string' || typeof v === 'boolean') links[k] = v;
      }
      p.passport = {
        title: doc.title,
        stage: doc.status,
        kind: str(f.kind),
        platforms: Array.isArray(f.platforms) ? f.platforms.filter((x): x is string => typeof x === 'string') : [],
        links,
        about: doc.body,
      };
    } else if (doc.kind === 'task') {
      p.tasks.push({
        id: doc.id,
        project: p.name,
        projectId: p.id,
        repo: doc.repo,
        title: doc.title ?? doc.id,
        status: doc.status,
        type: str(f.type),
        priority: int(f.priority),
        size: str(f.size),
        needsOwner: str(f['needs-owner']),
        plan: str(f.plan),
        branch: str(f.branch),
        pr: int(f.pr),
        updated: str(f.updated),
        body: doc.body,
        url,
      });
    } else if (doc.kind === 'plan') {
      p.plans.push({
        id: doc.id,
        title: doc.title ?? doc.id,
        status: doc.status,
        kind: str(f.kind),
        approved: str(f.approved),
        tasks: Array.isArray(f.tasks) ? f.tasks.filter((x): x is string => typeof x === 'string') : [],
        url,
      });
    } else {
      p.decisions.push({ id: doc.id, title: doc.title ?? doc.id, decided: str(f.decided), by: str(f.by), body: doc.body, url });
    }
  }

  const list = [...byProject.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const p of list) {
    p.tasks.sort(byUrgency);
    p.plans.sort((a, b) => b.id.localeCompare(a.id));
    p.decisions.sort((a, b) => b.id.localeCompare(a.id));
    p.counts = {
      open: p.tasks.length,
      needsOwner: p.tasks.filter((t) => t.needsOwner).length,
      inProgress: p.tasks.filter((t) => !t.needsOwner && t.status === 'in-progress').length,
      ready: p.tasks.filter((t) => !t.needsOwner && t.status === 'ready').length,
      ideas: p.tasks.filter((t) => !t.needsOwner && t.status === 'idea').length,
    };
  }
  const ownerTasks = list
    .flatMap((p) => p.tasks.filter((t) => t.needsOwner))
    .sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9) || a.project.localeCompare(b.project) || a.id.localeCompare(b.id));
  return { generatedAt: now.toISOString(), projects: list, ownerTasks };
}

export function summarizeBacklog(view: BacklogView): BacklogSummary {
  const byProject: BacklogSummary['byProject'] = {};
  for (const p of view.projects) byProject[p.id] = { stage: p.passport?.stage ?? null, ...p.counts };
  return { ownerTasks: view.ownerTasks, byProject };
}
