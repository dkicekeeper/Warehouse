import { isMacJob } from './queue';
import type { Job, Project, Repo } from './types';

/** What the shared macOS runners were busy with, day by day: build minutes per project and time spent waiting. */
export interface MacDay {
  /** The day where the owner lives, `YYYY-MM-DD`. */
  date: string;
  /** `DD.MM`, for the axis. */
  label: string;
  minutes: Record<string, number>;
  waitMin: number;
}

export interface MacHistory {
  days: MacDay[];
  /** Projects that built at least once in the window, busiest first. */
  projects: string[];
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

function dayIn(timezone: string): (d: Date) => string {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return (d) => fmt.format(d);
}

export function macHistory(history: Job[], repos: Repo[], projects: Project[], now: Date, timezone: string, span = 14): MacHistory {
  const day = dayIn(timezone);
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const nameOf = (repo: string) => {
    const known = repos.find((r) => r.fullName === repo);
    return (known && projectName.get(known.projectId)) ?? repo.split('/').pop() ?? repo;
  };

  const days: MacDay[] = [];
  for (let i = span - 1; i >= 0; i--) {
    const date = day(new Date(now.getTime() - i * DAY));
    days.push({ date, label: `${date.slice(8, 10)}.${date.slice(5, 7)}`, minutes: {}, waitMin: 0 });
  }
  const byDate = new Map(days.map((d) => [d.date, d]));
  const totals = new Map<string, number>();

  for (const j of history) {
    if (!isMacJob(j.labels) || j.status !== 'completed' || !j.startedAt || !j.completedAt) continue;
    const slot = byDate.get(day(j.completedAt));
    if (!slot) continue;
    const ran = Math.max(0, Math.round((j.completedAt.getTime() - j.startedAt.getTime()) / MINUTE));
    const waited = Math.max(0, Math.round((j.startedAt.getTime() - j.createdAt.getTime()) / MINUTE));
    const name = nameOf(j.repo);
    slot.minutes[name] = (slot.minutes[name] ?? 0) + ran;
    slot.waitMin += waited;
    totals.set(name, (totals.get(name) ?? 0) + ran);
  }
  return { days, projects: [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name) };
}
