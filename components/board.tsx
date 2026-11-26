'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AttentionRow, BoardView, ProjectView, QueueRowView } from '@/lib/domain/board';
import { approx, duration, plural, secondsAgo } from './format';

const POLL_MS = 15_000;

type Load = { board: BoardView | null; offline: boolean };

function useBoard() {
  const router = useRouter();
  const [state, setState] = useState<Load>({ board: null, offline: false });
  const [now, setNow] = useState<Date | null>(null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/board', { cache: 'no-store' });
      if (res.status === 401) {
        router.replace('/login');
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const board = (await res.json()) as BoardView;
      if (alive.current) setState({ board, offline: false });
    } catch {
      // Keep what is on screen: stale data that says so beats an empty page.
      if (alive.current) setState((s) => ({ ...s, offline: true }));
    }
  }, [router]);

  useEffect(() => {
    alive.current = true;
    const first = setTimeout(load, 0);
    const poll = setInterval(load, POLL_MS);
    const clock = setInterval(() => setNow(new Date()), 5000);
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive.current = false;
      clearTimeout(first);
      clearInterval(poll);
      clearInterval(clock);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  return { ...state, now, reload: load };
}

async function post(url: string, body?: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.ok) return null;
    if (res.status === 401) return 'Нужно войти заново: обновите страницу.';
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    return data?.error ?? `Не получилось (${res.status})`;
  } catch {
    return 'Нет связи с сервером';
  }
}

export function Board() {
  const { board, offline, now, reload } = useBoard();
  const [error, setError] = useState<string | null>(null);

  const act = useCallback(
    async (url: string, body?: unknown) => {
      const problem = await post(url, body);
      setError(problem);
      await reload();
    },
    [reload],
  );

  return (
    <div className="mx-auto max-w-3xl px-4 pb-16 pt-4">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-lg font-semibold">Warehouse</h1>
        <div className="flex items-baseline gap-3 text-xs text-muted">
          <span data-testid="freshness" className={offline ? 'text-bad' : undefined}>
            {offline ? 'нет связи · ' : ''}
            {board ? secondsAgo(board.generatedAt, now ?? new Date(board.generatedAt)) : offline ? '' : 'загрузка…'}
          </span>
          <Link href="/settings">Настройки</Link>
        </div>
      </header>

      {error && (
        <p role="alert" className="mt-3 rounded-md border border-line bg-warn-bg px-3 py-2 text-sm text-warn">
          {error}
        </p>
      )}
      {board?.warnings.map((w) => (
        <p key={w} role="status" className="mt-3 rounded-md border border-line bg-warn-bg px-3 py-2 text-sm text-warn">
          {w}
        </p>
      ))}

      {board && (
        <>
          <Attention rows={board.attention} snoozed={board.snoozed} act={act} />
          <Queue queue={board.queue} act={act} />
          <Projects projects={board.projects} />
        </>
      )}
    </div>
  );
}

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h2>
        {aside && <div className="text-xs text-muted">{aside}</div>}
      </div>
      <div className="overflow-hidden rounded-lg border border-line bg-panel">{children}</div>
    </section>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="px-3 py-4 text-sm text-muted">{children}</p>;

const Chip = ({ children }: { children: React.ReactNode }) => (
  <span className="shrink-0 rounded bg-paper px-1.5 py-0.5 text-xs font-medium">{children}</span>
);

const SmallButton = (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    type="button"
    {...props}
    className="min-h-8 rounded border border-line bg-paper px-2 text-xs text-ink hover:border-muted disabled:opacity-50"
  />
);

type Act = (url: string, body?: unknown) => Promise<void>;

function Attention({ rows, snoozed, act }: { rows: AttentionRow[]; snoozed: number; act: Act }) {
  const requests = rows.filter((r) => r.level === 'request').length;
  return (
    <Section
      title={`Ждёт вас (${requests})`}
      aside={snoozed > 0 ? `отложено: ${snoozed}` : undefined}
    >
      {rows.length === 0 ? (
        <Empty>Ничего не ждёт вашего внимания.</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <AttentionItem key={r.id} row={r} act={act} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function AttentionItem({ row, act }: { row: AttentionRow; act: Act }) {
  const [menu, setMenu] = useState(false);
  const note = row.level === 'note';
  return (
    <li data-testid="attention-row" className={`px-3 py-2.5 ${note ? 'opacity-70' : ''}`}>
      <div className="flex items-start gap-2">
        <Chip>{row.project}</Chip>
        <p className="min-w-0 flex-1 break-words text-sm">
          {row.fresh && <span title="ещё не отправлено в Telegram" className="mr-1 text-accent">●</span>}
          {row.text}
        </p>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-0.5 text-xs text-muted">
        <span>{duration(row.ageMin)}</span>
        {note && <span>заметка</span>}
        {row.prUrl && (
          <a href={row.prUrl} target="_blank" rel="noreferrer">
            PR
          </a>
        )}
        {row.sessionUrl && (
          <a href={row.sessionUrl} target="_blank" rel="noreferrer">
            сессия
          </a>
        )}
        <span className="ml-auto flex gap-1.5">
          {menu ? (
            <>
              <SmallButton onClick={() => act(`/api/items/${row.id}`, { action: 'snooze', until: 'tomorrow' })}>до завтра</SmallButton>
              <SmallButton onClick={() => act(`/api/items/${row.id}`, { action: 'snooze', until: 'week' })}>на неделю</SmallButton>
              <SmallButton onClick={() => setMenu(false)} aria-label="Не откладывать">
                ×
              </SmallButton>
            </>
          ) : (
            <>
              <SmallButton onClick={() => setMenu(true)}>отложить</SmallButton>
              <SmallButton onClick={() => act(`/api/items/${row.id}`, { action: 'dismiss' })}>закрыть</SmallButton>
            </>
          )}
        </span>
      </div>
    </li>
  );
}

const ORIGIN: Record<QueueRowView['origin'], string> = {
  session: 'сессия',
  manual: 'запущено вручную',
  schedule: 'по расписанию',
  push: 'пуш без сессии',
};

function Queue({ queue, act }: { queue: BoardView['queue']; act: Act }) {
  const free =
    queue.freeSlotInMin === null ? 'когда освободится — ~?' : queue.freeSlotInMin === 0 ? 'есть свободное место' : `свободное место через ${approx(queue.freeSlotInMin)}`;
  return (
    <Section title="Очередь macOS" aside={`идёт ${queue.running} · ждёт ${queue.waiting} · ${free}`}>
      {queue.rows.length === 0 ? (
        <Empty>Очередь пуста.</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {queue.rows.map((r) => (
            <QueueItem key={r.jobId} row={r} act={act} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function QueueItem({ row, act }: { row: QueueRowView; act: Act }) {
  const running = row.status === 'in_progress';
  const timing = running
    ? `${duration(row.elapsedMin ?? 0)} из ${approx(row.estimateMin)}`
    : `ждёт ${duration(row.waitingMin ?? 0)} · начнётся через ${approx(row.startsInMin)}`;
  const cancel = () => {
    if (window.confirm(`Отменить сборку «${row.workflow}» в ${row.project} (${row.branch || 'без ветки'})?`)) {
      void act(`/api/runs/${row.runId}/cancel`);
    }
  };
  return (
    <li data-testid="queue-row" className="px-3 py-2.5">
      <div className="flex items-start gap-2">
        <span aria-hidden className="w-4 shrink-0 text-center text-sm">
          {running ? '▶' : '⏳'}
        </span>
        <Chip>{row.project}</Chip>
        <p className="min-w-0 flex-1 text-sm">
          <a href={row.runUrl} target="_blank" rel="noreferrer" className="text-ink underline-offset-2 hover:underline">
            {row.workflow}
          </a>{' '}
          <span className="break-all text-muted">{row.branch}</span>
        </p>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-6 text-xs text-muted">
        <span className="sr-only">{running ? 'идёт' : 'ждёт'}</span>
        <span>{timing}</span>
        {row.sessionUrl ? (
          <a href={row.sessionUrl} target="_blank" rel="noreferrer">
            {row.sessionTitle ? `сессия «${row.sessionTitle}»` : 'сессия'}
          </a>
        ) : (
          <span>{row.origin === 'session' && row.sessionTitle ? `сессия «${row.sessionTitle}»` : ORIGIN[row.origin]}</span>
        )}
        {row.stale && <span className="rounded bg-warn-bg px-1.5 py-0.5 text-warn">устарел: есть сборка новее</span>}
        {(row.stale || !running) && (
          <span className="ml-auto">
            <SmallButton onClick={cancel}>отменить</SmallButton>
          </span>
        )}
      </div>
    </li>
  );
}

const CHECKS: Record<string, { text: string; tone: string }> = {
  success: { text: 'CI зелёный', tone: 'text-good' },
  failure: { text: 'CI упал', tone: 'text-bad' },
  pending: { text: 'CI идёт', tone: 'text-muted' },
  none: { text: 'без проверок', tone: 'text-muted' },
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

function Projects({ projects }: { projects: ProjectView[] }) {
  return (
    <Section title="Проекты">
      {projects.length === 0 ? (
        <Empty>Проектов пока нет: они появятся, когда приложение GitHub сообщит о репозиториях.</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {projects.map((p) => (
            <li key={p.id ?? 'none'} data-testid="project-row">
              <details>
                <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-sm">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-xs text-muted">
                    {plural(p.sessions.length, ['сессия', 'сессии', 'сессий'])} · {p.prs.length} PR
                    {p.waiting > 0 && <span className="text-accent"> · {p.waiting} ждёт вас</span>}
                  </span>
                </summary>
                <ProjectBody project={p} />
              </details>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function ProjectBody({ project: p }: { project: ProjectView }) {
  if (p.sessions.length + p.prs.length + p.runs.length === 0) {
    return <p className="px-3 pb-3 text-xs text-muted">Ни сессий, ни открытых PR, ни сборок за последние сутки.</p>;
  }
  return (
    <div className="space-y-3 px-3 pb-3 text-sm">
      {p.sessions.length > 0 && (
        <ul className="space-y-1.5">
          {p.sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-baseline gap-x-2">
              {s.url ? (
                <a href={s.url} target="_blank" rel="noreferrer">
                  {s.title ?? 'сессия'}
                </a>
              ) : (
                <span>{s.title ?? 'локальная сессия'}</span>
              )}
              <span className={`text-xs ${s.state === 'needs_owner' ? 'text-accent' : 'text-muted'}`}>
                {s.state === 'working' && !s.working ? 'молчит' : STATE[s.state]}
                {s.stateText ? ` — ${s.stateText}` : ''} · {duration(s.ageMin)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {p.prs.length > 0 && (
        <ul className="space-y-1.5">
          {p.prs.map((pr) => {
            const c = CHECKS[pr.checks] ?? { text: pr.checks, tone: 'text-muted' };
            return (
              <li key={`${pr.repo}#${pr.number}`} className="flex flex-wrap items-baseline gap-x-2">
                <a href={pr.url} target="_blank" rel="noreferrer">
                  #{pr.number} {pr.title}
                </a>
                <span className="text-xs text-muted">
                  <span className={c.tone}>{c.text}</span>
                  {pr.draft && ' · черновик'}
                  {pr.mergeable === false && <span className="text-bad"> · конфликт</span>} · ведёт: {pr.ledBy === 'session' ? 'сессия' : 'никто'} ·{' '}
                  {duration(pr.ageMin)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {p.runs.length > 0 && (
        <ul className="space-y-1 text-xs text-muted">
          {p.runs.map((r) => (
            <li key={r.id} className="flex flex-wrap gap-x-2">
              <a href={r.url} target="_blank" rel="noreferrer">
                {r.workflow}
              </a>
              <span className="break-all">{r.branch}</span>
              <span className={r.conclusion === 'failure' || r.conclusion === 'timed_out' ? 'text-bad' : r.conclusion === 'success' ? 'text-good' : undefined}>
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
