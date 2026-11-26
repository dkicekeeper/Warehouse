'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BacklogView, DecisionRow, PlanRow, ProjectBacklog, TaskRow } from '@/lib/domain/backlog';
import { duration, planLabel, plural, stageLabel, taskLabel, typeLabel } from './format';

const POLL_MS = 60_000;
type View = BacklogView & { syncedAt: string | null };
type Filter = 'open' | 'owner' | 'in-progress' | 'ready' | 'idea';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'open', label: 'Все' },
  { id: 'owner', label: 'Ждут вас' },
  { id: 'in-progress', label: 'В работе' },
  { id: 'ready', label: 'Готовы' },
  { id: 'idea', label: 'Идеи' },
];

const matches = (t: TaskRow, f: Filter) =>
  f === 'open' || (f === 'owner' ? !!t.needsOwner : !t.needsOwner && t.status === f);

function useBacklog() {
  const router = useRouter();
  const [view, setView] = useState<View | null>(null);
  const [offline, setOffline] = useState(false);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/backlog', { cache: 'no-store' });
      if (res.status === 401) {
        router.replace('/login');
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as View;
      if (alive.current) {
        setView(data);
        setOffline(false);
      }
    } catch {
      if (alive.current) setOffline(true);
    }
  }, [router]);

  useEffect(() => {
    alive.current = true;
    const first = setTimeout(load, 0);
    const poll = setInterval(load, POLL_MS);
    return () => {
      alive.current = false;
      clearTimeout(first);
      clearInterval(poll);
    };
  }, [load]);

  return { view, offline };
}

/** The chosen project lives in the address, so a link from the board opens it. */
function useProjectParam(): [string | null, (id: string | null) => void] {
  const [project, setProject] = useState<string | null>(null);
  useEffect(() => {
    const first = setTimeout(() => setProject(new URLSearchParams(window.location.search).get('project')), 0);
    return () => clearTimeout(first);
  }, []);
  const choose = useCallback((id: string | null) => {
    setProject(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('project', id);
    else url.searchParams.delete('project');
    window.history.replaceState(null, '', url);
  }, []);
  return [project, choose];
}

export function Backlog() {
  const { view, offline } = useBacklog();
  const [projectId, chooseProject] = useProjectParam();
  const [filter, setFilter] = useState<Filter>('open');

  const project = view?.projects.find((p) => p.id === projectId) ?? null;
  const tasks = (project ? project.tasks : (view?.projects.flatMap((p) => p.tasks) ?? [])).filter((t) => matches(t, filter));
  const read = view?.syncedAt
    ? `прочитано ${duration(Math.max(0, Math.round((Date.parse(view.generatedAt) - Date.parse(view.syncedAt)) / 60_000)))} назад`
    : 'репозитории ещё не прочитаны';

  return (
    <div className="mx-auto max-w-3xl px-4 pb-16 pt-4">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h1 className="text-lg font-semibold">Задачи и планы</h1>
        <div className="flex items-baseline gap-3 text-xs text-muted">
          <span className={offline ? 'text-bad' : undefined}>{offline ? 'нет связи' : view ? read : 'загрузка…'}</span>
          <Link href="/">Диспетчерская</Link>
        </div>
      </header>

      {view && (
        <>
          <nav aria-label="Проект" className="mt-4 flex flex-wrap gap-1.5">
            <Pill active={!project} onClick={() => chooseProject(null)}>
              Все проекты
            </Pill>
            {view.projects.map((p) => (
              <Pill key={p.id} active={project?.id === p.id} onClick={() => chooseProject(p.id)}>
                {p.name}
                {p.counts.needsOwner > 0 && <span className="text-accent"> · {p.counts.needsOwner}</span>}
              </Pill>
            ))}
          </nav>

          {view.projects.length === 0 && (
            <p className="mt-6 rounded-lg border border-line bg-panel px-3 py-4 text-sm text-muted">
              Пока пусто: сервис читает <code>docs/</code> репозиториев после пуша в основную ветку и раз в полчаса.
            </p>
          )}

          {project && <PassportCard project={project} />}

          {view.projects.length > 0 && (
            <Section
              title="Задачи"
              aside={
                <span className="flex flex-wrap gap-1.5">
                  {FILTERS.map((f) => (
                    <Pill key={f.id} small active={filter === f.id} onClick={() => setFilter(f.id)}>
                      {f.label}
                    </Pill>
                  ))}
                </span>
              }
            >
              {tasks.length === 0 ? (
                <Empty>Таких задач нет.</Empty>
              ) : (
                <ul className="divide-y divide-line">
                  {tasks.map((t) => (
                    <TaskItem key={`${t.repo}/${t.id}`} task={t} showProject={!project} />
                  ))}
                </ul>
              )}
            </Section>
          )}

          {project && project.plans.length > 0 && (
            <Section title="Планы в работе">
              <ul className="divide-y divide-line">
                {project.plans.map((p) => (
                  <PlanItem key={p.id} plan={p} />
                ))}
              </ul>
            </Section>
          )}

          {project && project.decisions.length > 0 && (
            <Section title="Решения" aside={plural(project.decisions.length, ['решение', 'решения', 'решений'])}>
              <ul className="divide-y divide-line">
                {project.decisions.map((d) => (
                  <DecisionItem key={d.id} decision={d} />
                ))}
              </ul>
            </Section>
          )}
        </>
      )}
    </div>
  );
}

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h2>
        {aside && <div className="text-xs text-muted">{aside}</div>}
      </div>
      <div className="overflow-hidden rounded-lg border border-line bg-panel">{children}</div>
    </section>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="px-3 py-4 text-sm text-muted">{children}</p>;

function Pill({ active, small, onClick, children }: { active: boolean; small?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full border px-2.5 ${small ? 'min-h-7 text-xs' : 'min-h-8 text-sm'} ${
        active ? 'border-ink bg-ink text-paper' : 'border-line bg-paper text-ink hover:border-muted'
      }`}
    >
      {children}
    </button>
  );
}

const Chip = ({ tone, children }: { tone?: 'accent' | 'good'; children: React.ReactNode }) => (
  <span
    className={`shrink-0 rounded bg-paper px-1.5 py-0.5 text-xs font-medium ${tone === 'accent' ? 'text-accent' : tone === 'good' ? 'text-good' : ''}`}
  >
    {children}
  </span>
);

function PassportCard({ project: p }: { project: ProjectBacklog }) {
  const links = Object.entries(p.passport?.links ?? {}).filter((e): e is [string, string] => typeof e[1] === 'string');
  const linkName: Record<string, string> = { store: 'App Store', site: 'сайт' };
  return (
    <section className="mt-4 rounded-lg border border-line bg-panel px-3 py-3" data-testid="passport">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 className="text-base font-semibold">{p.passport?.title ?? p.name}</h2>
        {p.passport?.stage && <Chip tone="good">{stageLabel(p.passport.stage)}</Chip>}
        <span className="text-xs text-muted">
          {plural(p.counts.open, ['задача', 'задачи', 'задач'])}
          {p.counts.needsOwner > 0 && <span className="text-accent"> · {p.counts.needsOwner} ждёт вас</span>}
          {p.counts.inProgress > 0 && ` · ${p.counts.inProgress} в работе`}
        </span>
      </div>
      {p.passport ? (
        <p className="mt-2 whitespace-pre-line text-sm">{p.passport.about}</p>
      ) : (
        <p className="mt-2 text-sm text-muted">У проекта нет паспорта (docs/project.md).</p>
      )}
      <p className="mt-2 flex flex-wrap gap-x-3 text-xs">
        {links.map(([key, url]) => (
          <a key={key} href={url} target="_blank" rel="noreferrer">
            {linkName[key] ?? key}
          </a>
        ))}
        {p.repos.map((repo) => (
          <a key={repo} href={`https://github.com/${repo}`} target="_blank" rel="noreferrer">
            {repo}
          </a>
        ))}
      </p>
    </section>
  );
}

function TaskItem({ task: t, showProject }: { task: TaskRow; showProject: boolean }) {
  const meta = [typeLabel(t.type), t.priority ? `приоритет ${t.priority}` : '', t.size ? `размер ${t.size}` : '', t.updated ?? ''].filter(Boolean);
  return (
    <li data-testid="task-row">
      <details>
        <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-sm">
          <Chip tone={t.needsOwner ? 'accent' : t.status === 'in-progress' ? 'good' : undefined}>{taskLabel(t)}</Chip>
          {showProject && <span className="text-xs text-muted">{t.project}</span>}
          <span className="min-w-0 basis-full sm:basis-auto sm:flex-1">{t.title}</span>
          {t.needsOwner && <span className="basis-full text-xs text-accent">Нужно от вас: {t.needsOwner}</span>}
        </summary>
        <div className="px-3 pb-3 text-sm">
          {meta.length > 0 && <p className="text-xs text-muted">{meta.join(' · ')}</p>}
          {t.body && <p className="mt-2 whitespace-pre-line break-words">{t.body}</p>}
          <p className="mt-2 flex flex-wrap gap-x-3 text-xs">
            <a href={t.url} target="_blank" rel="noreferrer">
              файл в GitHub
            </a>
            {t.pr !== null && (
              <a href={`https://github.com/${t.repo}/pull/${t.pr}`} target="_blank" rel="noreferrer">
                PR #{t.pr}
              </a>
            )}
            {t.branch && <span className="break-all text-muted">{t.branch}</span>}
          </p>
        </div>
      </details>
    </li>
  );
}

function PlanItem({ plan: p }: { plan: PlanRow }) {
  return (
    <li className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-sm">
      <Chip tone={p.status === 'in-progress' ? 'good' : undefined}>{planLabel(p.status)}</Chip>
      <span className="text-xs text-muted">
        {p.kind === 'design' ? 'дизайн' : 'план'}
        {p.approved && ` · одобрен ${p.approved}`}
        {p.tasks.length > 0 && ` · ${plural(p.tasks.length, ['задача', 'задачи', 'задач'])}`}
      </span>
      <a href={p.url} target="_blank" rel="noreferrer" className="min-w-0 basis-full break-words text-ink underline-offset-2 hover:underline">
        {p.title}
      </a>
    </li>
  );
}

function DecisionItem({ decision: d }: { decision: DecisionRow }) {
  return (
    <li>
      <details>
        <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-sm">
          <span className="shrink-0 text-xs text-muted">{d.decided ?? ''}</span>
          <span className="min-w-0 flex-1">{d.title}</span>
          {d.by === 'claude' && <span className="text-xs text-muted">решил Claude</span>}
        </summary>
        <div className="px-3 pb-3 text-sm">
          <p className="whitespace-pre-line break-words">{d.body}</p>
          <p className="mt-2 text-xs">
            <a href={d.url} target="_blank" rel="noreferrer">
              файл в GitHub
            </a>
          </p>
        </div>
      </details>
    </li>
  );
}
