'use client';

import Link from 'next/link';
import type { ProjectView } from '@/lib/domain/board';
import { projectCards, type ProjectCard, type TaskSegments } from '@/lib/domain/overview';
import { cn } from '@/lib/utils';
import { useBoardData } from './board-data';
import { duration, plural, stageLabel } from './format';
import { Chip, EmptyRow, Notice, Page, link } from './page';
import { Card, CardContent } from './ui/card';
import { Skeleton } from './ui/skeleton';

export function Projects() {
  const { board, offline } = useBoardData();
  const cards = board ? projectCards(board) : [];
  return (
    <Page title="Проекты" wide>
      {board?.warnings.map((w) => (
        <Notice key={w}>{w}</Notice>
      ))}
      {!board && !offline && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      )}
      {board && cards.length === 0 && (
        <Card>
          <EmptyRow>Проектов пока нет: они появятся, когда приложение GitHub сообщит о репозиториях.</EmptyRow>
        </Card>
      )}
      {board && cards.length > 0 && (
        <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((c, i) => (
            <ProjectCardView key={c.id ?? 'none'} card={c} project={board.projects[i]!} />
          ))}
        </div>
      )}
    </Page>
  );
}

const SEGMENTS: { key: keyof TaskSegments; label: string; tone: string }[] = [
  { key: 'needsOwner', label: 'ждут вас', tone: 'bg-warning' },
  { key: 'inProgress', label: 'в работе', tone: 'bg-primary' },
  { key: 'ready', label: 'готовы', tone: 'bg-success' },
  { key: 'ideas', label: 'идеи', tone: 'bg-muted-foreground/40' },
  { key: 'other', label: 'заблокированы', tone: 'bg-border' },
];

function TaskBar({ segments, total }: { segments: TaskSegments; total: number }) {
  if (total === 0) return <p className="text-xs text-muted-foreground">Открытых задач нет.</p>;
  const parts = SEGMENTS.filter((s) => segments[s.key] > 0);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden>
        {parts.map((s) => (
          <span key={s.key} className={cn('h-full first:rounded-l-full last:rounded-r-full', s.tone)} style={{ flexGrow: segments[s.key] }} />
        ))}
      </div>
      <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        {parts.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1">
            <span className={cn('size-2 rounded-full', s.tone)} aria-hidden />
            {s.label} {segments[s.key]}
          </span>
        ))}
      </p>
    </div>
  );
}

function ProjectCardView({ card: c, project }: { card: ProjectCard; project: ProjectView }) {
  return (
    <Card size="sm" data-testid="project-row" className="gap-0 py-0">
      <CardContent className="flex flex-col gap-3 py-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <h2 className="mr-auto text-base font-medium">
            {c.id ? (
              <Link href={`/backlog?project=${encodeURIComponent(c.id)}`} className="hover:underline">
                {c.name}
              </Link>
            ) : (
              c.name
            )}
          </h2>
          {c.stage && <Chip tone="plain">{stageLabel(c.stage)}</Chip>}
          {c.broken && <Chip tone="plain">CI красный</Chip>}
          {c.requests > 0 && <Chip tone="strong">ждёт вас: {c.requests}</Chip>}
        </div>
        {c.segments ? (
          <div data-testid="project-docs" className="flex flex-col gap-1">
            <Link href={`/backlog?project=${encodeURIComponent(c.id ?? '')}`} className={cn('text-sm', link)}>
              {plural(c.openTasks, ['задача', 'задачи', 'задач'])}
            </Link>
            <TaskBar segments={c.segments} total={c.openTasks} />
          </div>
        ) : (
          c.id && <p className="text-xs text-muted-foreground">Документы проекта ещё не прочитаны.</p>
        )}
        <dl className="grid grid-cols-3 gap-2 border-t pt-3 text-xs">
          <div>
            <dt className="text-muted-foreground">Сессии</dt>
            <dd className="text-sm font-medium tabular-nums">
              {c.sessions}
              {c.sessionsWorking > 0 && <span className="font-normal text-muted-foreground"> · {c.sessionsWorking} работает</span>}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">PR</dt>
            <dd className="text-sm font-medium tabular-nums">{c.prs}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Активность</dt>
            <dd className="text-sm font-medium">{c.lastActivityMin === null ? 'нет' : `${duration(c.lastActivityMin)} назад`}</dd>
          </div>
        </dl>
        {project.sessions.length + project.prs.length + project.runs.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-xs text-muted-foreground">Сессии, PR и сборки</summary>
            <ProjectBody project={project} />
          </details>
        )}
      </CardContent>
    </Card>
  );
}

const CHECKS: Record<string, { text: string; tone: string }> = {
  success: { text: 'CI зелёный', tone: 'text-success' },
  failure: { text: 'CI упал', tone: 'text-destructive' },
  pending: { text: 'CI идёт', tone: 'text-muted-foreground' },
  none: { text: 'без проверок', tone: 'text-muted-foreground' },
};

const CONCLUSION: Record<string, string> = {
  success: 'прошёл',
  failure: 'упал',
  cancelled: 'отменён',
  timed_out: 'не уложился во время',
  skipped: 'пропущен',
};

const STATE: Record<string, string> = {
  needs_owner: 'ждёт владельца',
  working: 'работает',
  done: 'готово',
  unknown: 'без статуса',
};

function ProjectBody({ project: p }: { project: ProjectView }) {
  return (
    <div className="flex flex-col gap-3 pt-3">
      {p.sessions.length > 0 && (
        <ul className="space-y-1.5">
          {p.sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-baseline gap-x-2">
              {s.url ? (
                <a href={s.url} target="_blank" rel="noreferrer" className={link}>
                  {s.title ?? 'сессия'}
                </a>
              ) : (
                <span>{s.title ?? 'локальная сессия'}</span>
              )}
              <span className={`text-xs ${s.state === 'needs_owner' ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
                {s.state === 'working' && !s.working ? 'молчит' : STATE[s.state]}
                {s.stateText ? `: ${s.stateText}` : ''} · {duration(s.ageMin)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {p.prs.length > 0 && (
        <ul className="space-y-1.5">
          {p.prs.map((pr) => {
            const c = CHECKS[pr.checks] ?? { text: pr.checks, tone: 'text-muted-foreground' };
            return (
              <li key={`${pr.repo}#${pr.number}`} className="flex flex-wrap items-baseline gap-x-2">
                <a href={pr.url} target="_blank" rel="noreferrer" className={link}>
                  #{pr.number} {pr.title}
                </a>
                <span className="text-xs text-muted-foreground">
                  <span className={c.tone}>{c.text}</span>
                  {pr.draft && ' · черновик'}
                  {pr.mergeable === false && <span className="text-destructive"> · конфликт</span>} · ведёт: {pr.ledBy === 'session' ? 'сессия' : 'никто'} ·{' '}
                  {duration(pr.ageMin)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {p.runs.length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {p.runs.map((r) => (
            <li key={r.id} className="flex flex-wrap gap-x-2">
              <a href={r.url} target="_blank" rel="noreferrer" className={link}>
                {r.workflow}
              </a>
              <span className="break-all">{r.branch}</span>
              <span className={r.conclusion === 'failure' || r.conclusion === 'timed_out' ? 'text-destructive' : r.conclusion === 'success' ? 'text-success' : undefined}>
                {r.status === 'completed' ? (CONCLUSION[r.conclusion ?? ''] ?? r.conclusion ?? 'завершён') : r.status === 'in_progress' ? 'идёт' : 'в очереди'}
              </span>
              <span>{duration(r.ageMin)} назад</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
