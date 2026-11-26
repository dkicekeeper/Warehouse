'use client';

import { ChevronRight } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import type { QueueRowView } from '@/lib/domain/board';
import { buildInbox, kpis, relatedOf, type BoardResponse, type InboxRow, type InboxTab } from '@/lib/domain/overview';
import { cn } from '@/lib/utils';
import { useBoardData, useWide, type Act } from './board-data';
import { approx, days, duration, plainText, plural, taskLabel, typeLabel } from './format';
import { Chip, EmptyRow, Notice, Page, Section, SmallButton, link } from './page';
import { buttonVariants } from './ui/button';
import { Card, CardContent } from './ui/card';
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from './ui/chart';
import { Progress } from './ui/progress';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet';
import { Skeleton } from './ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';

export function Overview() {
  const { board, offline, error } = useBoardData();
  return (
    <Page title="Обзор" wide>
      {error && (
        <Notice role="alert" tone="error">
          {error}
        </Notice>
      )}
      {board?.warnings.map((w) => (
        <Notice key={w}>{w}</Notice>
      ))}
      {!board && !offline && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-64 w-full rounded-xl" />
        </>
      )}
      {board && (
        <>
          <Kpis board={board} />
          <Inbox board={board} />
          <div className="grid items-start gap-6 xl:grid-cols-[3fr_2fr]">
            <MacChart board={board} />
            <QueueNow queue={board.queue} />
          </div>
        </>
      )}
    </Page>
  );
}

function Kpi({ label, value, sub, testid }: { label: string; value: React.ReactNode; sub: React.ReactNode; testid: string }) {
  return (
    <Card size="sm" data-testid={testid}>
      <CardContent className="flex flex-col gap-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );
}

function freeText(min: number | null): string {
  if (min === null) return 'когда освободится — ~?';
  return min === 0 ? 'есть свободное место' : `свободное место через ${approx(min)}`;
}

function Kpis({ board }: { board: BoardResponse }) {
  const k = kpis(board);
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Kpi
        testid="kpi-waiting"
        label="Ждёт вас"
        value={k.requests + k.ownerTasks}
        sub={`${plural(k.requests, ['просьба', 'просьбы', 'просьб'])} · ${plural(k.ownerTasks, ['задача', 'задачи', 'задач'])}`}
      />
      <Kpi
        testid="kpi-sessions"
        label="Сессии в работе"
        value={k.sessionsWorking}
        sub={k.sessionsSilent > 0 ? `молчат: ${k.sessionsSilent}` : 'все на связи'}
      />
      <Kpi
        testid="kpi-queue"
        label="Очередь macOS"
        value={
          <>
            {k.queueRunning}
            <span className="text-base font-normal text-muted-foreground"> идёт · {k.queueWaiting} ждёт</span>
          </>
        }
        sub={freeText(k.freeSlotInMin)}
      />
      <Kpi testid="kpi-tasks" label="Открытые задачи" value={k.openTasks} sub={`в работе ${k.inProgress} · готовы ${k.ready}`} />
    </div>
  );
}

const TABS: { id: 'all' | InboxTab; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'sessions', label: 'Сессии' },
  { id: 'prs', label: 'PR и CI' },
  { id: 'tasks', label: 'Задачи' },
];

function Inbox({ board }: { board: BoardResponse }) {
  const rows = useMemo(() => buildInbox(board, new Date(board.generatedAt)), [board]);
  const [tab, setTab] = useState<'all' | InboxTab>('all');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const shown = tab === 'all' ? rows : rows.filter((r) => r.tab === tab);
  // Looked up afresh on every poll: the panel shows the item as it is now, and closes when it is gone.
  const open = openKey ? (rows.find((r) => r.key === openKey) ?? null) : null;
  const waiting = rows.filter((r) => r.level !== 'note').length;

  return (
    <section id="inbox" aria-labelledby="inbox-title">
      <Card size="sm" className="gap-0 py-0">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b px-4 py-3">
          <h2 id="inbox-title" className="flex items-center gap-2 text-sm font-medium">
            Ждёт вас
            <Chip tone={waiting > 0 ? 'strong' : 'plain'}>{waiting}</Chip>
          </h2>
          <div className="flex flex-wrap items-center gap-3">
            {board.snoozed > 0 && <span className="text-xs text-muted-foreground">отложено: {board.snoozed}</span>}
            <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
              <TabsList aria-label="Что показать">
                {TABS.map((t) => {
                  const n = t.id === 'all' ? rows.length : rows.filter((r) => r.tab === t.id).length;
                  return (
                    <TabsTrigger key={t.id} value={t.id} className="px-2 text-xs">
                      {t.label}
                      {n > 0 && <span className="tabular-nums text-muted-foreground">{n}</span>}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </Tabs>
          </div>
        </div>
        {shown.length === 0 ? (
          <EmptyRow>{rows.length === 0 ? 'Ничего не ждёт вашего внимания.' : 'Здесь пусто.'}</EmptyRow>
        ) : (
          <ul className="divide-y divide-border">
            {shown.map((r) => (
              <InboxItem key={r.key} row={r} onOpen={() => setOpenKey(r.key)} />
            ))}
          </ul>
        )}
      </Card>
      <Detail board={board} row={open} onClose={() => setOpenKey(null)} />
    </section>
  );
}

const ageText = (row: InboxRow): string =>
  row.ageMin !== null ? duration(row.ageMin) : row.ageDays !== null ? days(row.ageDays) : '';

function InboxItem({ row, onOpen }: { row: InboxRow; onOpen: () => void }) {
  return (
    <li data-testid={row.task ? 'owner-task' : 'attention-row'} className={row.level === 'note' ? 'opacity-70' : undefined}>
      <button
        type="button"
        onClick={onOpen}
        className="grid w-full grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none md:grid-cols-[8rem_1fr_8rem_5.5rem_1rem]"
      >
        <span className="col-span-2 flex items-center gap-2 md:col-span-1">
          <Chip>{row.project}</Chip>
          <span className="text-xs text-muted-foreground md:hidden">
            {row.kind}
            {ageText(row) && ` · ${ageText(row)}`}
          </span>
        </span>
        <span className="min-w-0 text-sm">
          {row.item?.fresh && (
            <span title="ещё не отправлено в Telegram" className="mr-1 font-medium">
              ●
            </span>
          )}
          <span className="break-words">{row.title}</span>
          {row.sub && <span className="mt-0.5 block text-xs text-muted-foreground">{row.sub}</span>}
        </span>
        <span className="hidden md:block">
          <Chip tone={row.level === 'request' ? 'strong' : 'plain'}>{row.kind}</Chip>
        </span>
        <span className="hidden text-xs tabular-nums text-muted-foreground md:block">{ageText(row)}</span>
        <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
      </button>
    </li>
  );
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('text-sm font-medium', tone)}>{value}</p>
    </div>
  );
}

const CHECKS: Record<string, { text: string; tone?: string }> = {
  success: { text: 'зелёный', tone: 'text-success' },
  failure: { text: 'упал', tone: 'text-destructive' },
  pending: { text: 'идёт' },
  none: { text: 'без проверок' },
};

const STATE: Record<string, string> = {
  needs_owner: 'ждёт владельца',
  working: 'работает',
  done: 'готово',
  unknown: 'без статуса',
};

function Detail({ board, row, onClose }: { board: BoardResponse; row: InboxRow | null; onClose: () => void }) {
  const wide = useWide();
  // Focus lands on the top of the panel, so a long panel opens at its title, not scrolled to a button.
  const top = useRef<HTMLDivElement>(null);
  return (
    <Sheet open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        initialFocus={top}
        side={wide ? 'right' : 'bottom'}
        data-testid="detail"
        className={cn('gap-0 overflow-y-auto', wide ? 'w-full sm:max-w-md' : 'max-h-[85dvh] rounded-t-xl')}
      >
        <div ref={top} tabIndex={-1} className="outline-none" />
        {row?.item && <ItemDetail board={board} row={row} onDone={onClose} />}
        {row?.task && <TaskDetail row={row} />}
      </SheetContent>
    </Sheet>
  );
}

function DetailHead({ row, description }: { row: InboxRow; description: string }) {
  return (
    <SheetHeader className="gap-2 pr-12">
      <div className="flex flex-wrap gap-1.5">
        <Chip>{row.project}</Chip>
        <Chip tone={row.level === 'request' ? 'strong' : 'plain'}>{row.kind}</Chip>
      </div>
      <SheetTitle className="break-words">{row.title}</SheetTitle>
      <SheetDescription>{description}</SheetDescription>
    </SheetHeader>
  );
}

function ItemDetail({ board, row, onDone }: { board: BoardResponse; row: InboxRow; onDone: () => void }) {
  const { act } = useBoardData();
  const item = row.item!;
  const { project, session, pr } = relatedOf(board, item);
  const run = async (body: unknown) => {
    onDone();
    await act(`/api/items/${item.id}`, body);
  };
  const checks = pr ? (CHECKS[pr.checks] ?? { text: pr.checks }) : null;
  const facts: { label: string; value: string; tone?: string }[] = [{ label: 'Ждёт', value: duration(item.ageMin) }];
  if (pr && checks) {
    facts.push({ label: 'CI', value: checks.text, tone: checks.tone });
    facts.push({
      label: 'Мерж',
      value: pr.mergeable === false ? 'конфликт' : pr.mergeable ? (pr.draft ? 'черновик' : 'можно') : 'проверяется',
      tone: pr.mergeable === false ? 'text-destructive' : undefined,
    });
  } else {
    if (session) facts.push({ label: 'Сессия', value: session.state === 'working' && !session.working ? 'молчит' : (STATE[session.state] ?? session.state) });
    facts.push({ label: 'Telegram', value: item.fresh ? 'ещё не отправлено' : 'отправлено' });
  }
  const runs = project?.runs.slice(0, 3) ?? [];

  return (
    <>
      <DetailHead row={row} description={item.level === 'note' ? 'Заметка: сервис разобрался сам, это для сведения.' : 'Нужно ваше решение или действие.'} />
      <div className="flex flex-col gap-5 px-4 pb-4">
        <div className="grid grid-cols-3 gap-2">
          {facts.slice(0, 3).map((f) => (
            <Fact key={f.label} {...f} />
          ))}
        </div>
        {(session || pr || runs.length > 0) && (
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-medium text-muted-foreground">Что известно</h3>
            <ol className="flex flex-col gap-3 border-l pl-4 text-sm">
              {session && (
                <li>
                  {session.url ? (
                    <a href={session.url} target="_blank" rel="noreferrer" className={link}>
                      {session.title ?? 'сессия'}
                    </a>
                  ) : (
                    (session.title ?? 'локальная сессия')
                  )}
                  <p className="text-xs text-muted-foreground">
                    {session.state === 'working' && !session.working ? 'молчит' : STATE[session.state]}
                    {session.stateText ? `: ${session.stateText}` : ''} · {duration(session.ageMin)} назад
                  </p>
                </li>
              )}
              {pr && checks && (
                <li>
                  <a href={pr.url} target="_blank" rel="noreferrer" className={link}>
                    #{pr.number} {pr.title}
                  </a>
                  <p className="text-xs text-muted-foreground">
                    CI <span className={checks.tone}>{checks.text}</span> · ведёт: {pr.ledBy === 'session' ? 'сессия' : 'никто'} · открыт {duration(pr.ageMin)} назад
                  </p>
                </li>
              )}
              {runs.map((r) => (
                <li key={r.id}>
                  <a href={r.url} target="_blank" rel="noreferrer" className={link}>
                    {r.workflow}
                  </a>{' '}
                  <span className="break-all text-xs text-muted-foreground">{r.branch}</span>
                  <p className="text-xs text-muted-foreground">
                    {r.status === 'completed' ? (r.conclusion === 'success' ? 'прошёл' : r.conclusion === 'failure' ? 'упал' : (r.conclusion ?? 'завершён')) : r.status === 'in_progress' ? 'идёт' : 'в очереди'} ·{' '}
                    {duration(r.ageMin)} назад
                  </p>
                </li>
              ))}
            </ol>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {item.prUrl && (
            <a href={item.prUrl} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'default', size: 'sm' })}>
              Открыть PR
            </a>
          )}
          {item.sessionUrl && (
            <a href={item.sessionUrl} target="_blank" rel="noreferrer" className={buttonVariants({ variant: item.prUrl ? 'outline' : 'default', size: 'sm' })}>
              Открыть сессию
            </a>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <span className="text-xs text-muted-foreground">Отложить:</span>
          <SmallButton onClick={() => run({ action: 'snooze', until: 'tomorrow' })}>до завтра</SmallButton>
          <SmallButton onClick={() => run({ action: 'snooze', until: 'week' })}>на неделю</SmallButton>
          <SmallButton className="ml-auto" onClick={() => run({ action: 'dismiss' })}>
            закрыть
          </SmallButton>
        </div>
        <p className="text-xs text-muted-foreground">«Закрыть» убирает пункт; если причина останется, он вернётся с новым текстом.</p>
      </div>
    </>
  );
}

function TaskDetail({ row }: { row: InboxRow }) {
  const t = row.task!;
  return (
    <>
      <DetailHead row={row} description={`Задача из docs/backlog: ${taskLabel(t)}.`} />
      <div className="flex flex-col gap-5 px-4 pb-4">
        <div className="grid grid-cols-3 gap-2">
          <Fact label="Приоритет" value={t.priority === 1 ? 'срочно' : t.priority === 2 ? 'обычно' : t.priority === 3 ? 'когда-нибудь' : '—'} tone={t.priority === 1 ? 'text-destructive' : undefined} />
          <Fact label="Размер" value={t.size ?? '—'} />
          <Fact label="Тип" value={typeLabel(t.type) || '—'} />
        </div>
        {t.needsOwner && (
          <div className="rounded-lg border border-warning/40 px-3 py-2 text-sm">
            <p className="text-xs text-warning">Нужно от вас</p>
            <p>{t.needsOwner}</p>
          </div>
        )}
        {t.body && <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{plainText(t.body)}</p>}
        <p className="text-xs text-muted-foreground">
          {t.updated && `обновлена ${t.updated}`}
          {t.plan && ` · план ${t.plan}`}
        </p>
        <div className="flex flex-wrap gap-2">
          <a href={t.url} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'default', size: 'sm' })}>
              Открыть задачу
            </a>
          {t.pr !== null && (
            <a href={`https://github.com/${t.repo}/pull/${t.pr}`} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              PR #{t.pr}
            </a>
          )}
        </div>
        <p className="text-xs text-muted-foreground">Задача уйдёт отсюда, когда в её файле снимут «needs-owner».</p>
      </div>
    </>
  );
}

/** Long spans in hours: «38 ч», not «1 дн». */
const hours = (min: number) => (min < 60 ? `${min} мин` : `${Math.round(min / 60)} ч`);

/** Up to five projects keep their own colour (the theme's chart tokens, by name); the rest are «Другие». */
const SLOTS = 5;

function MacChart({ board }: { board: BoardResponse }) {
  const history = board.macBuilds;
  const { data, config, keys, total, wait } = useMemo(() => {
    // Colours go to the projects that build on macOS, by name: a project keeps its colour from day to day.
    const known = [...(history?.projects ?? [])].sort((a, b) => a.localeCompare(b));
    const built = new Set(known);
    const keyOf = (name: string) => {
      const i = known.indexOf(name);
      return i >= 0 && i < SLOTS ? `p${i}` : 'other';
    };
    const config: ChartConfig = {};
    for (const name of known) {
      if (!built.has(name)) continue;
      const key = keyOf(name);
      config[key] = key === 'other' ? { label: 'Другие', color: 'var(--muted-foreground)' } : { label: name, color: `var(--chart-${Number(key.slice(1)) + 1})` };
    }
    const keys = Object.keys(config).sort((a, b) => (a === 'other' ? 1 : b === 'other' ? -1 : a.localeCompare(b)));
    const data = (history?.days ?? []).map((d) => {
      const row: Record<string, string | number> = { label: d.label };
      for (const k of keys) row[k] = 0;
      for (const [name, min] of Object.entries(d.minutes)) row[keyOf(name)] = (Number(row[keyOf(name)]) || 0) + min;
      return row;
    });
    const total = (history?.days ?? []).reduce((n, d) => n + Object.values(d.minutes).reduce((a, b) => a + b, 0), 0);
    const wait = (history?.days ?? []).reduce((n, d) => n + d.waitMin, 0);
    return { data, config, keys, total, wait };
  }, [history]);

  return (
    <Section title="Сборки macOS за 14 дней, минут" aside={total > 0 ? `всего ${hours(total)} · ждали очереди ${hours(wait)}` : undefined}>
      {!history || total === 0 ? (
        <EmptyRow>За две недели сборок macOS не было.</EmptyRow>
      ) : (
        <div className="px-2 pb-3 pt-4" data-testid="mac-chart">
          <ChartContainer config={config} className="aspect-auto h-56 w-full">
            <BarChart data={data} accessibilityLayer margin={{ left: 0, right: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={12} />
              <YAxis tickLine={false} axisLine={false} width={44} />
              <ChartTooltip cursor={{ fill: 'var(--muted)', opacity: 0.5 }} content={<ChartTooltipContent />} />
              <ChartLegend content={<ChartLegendContent />} />
              {keys.map((k, i) => (
                <Bar key={k} dataKey={k} stackId="mac" fill={`var(--color-${k})`} stroke="var(--card)" strokeWidth={1} radius={i === keys.length - 1 ? [4, 4, 0, 0] : 0} />
              ))}
            </BarChart>
          </ChartContainer>
          <details className="px-2 pt-2 text-xs">
            <summary className="cursor-pointer text-muted-foreground">Таблицей</summary>
            <table className="mt-2 w-full tabular-nums">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="py-1 text-left font-normal">День</th>
                  {keys.map((k) => (
                    <th key={k} className="py-1 text-right font-normal">
                      {String(config[k]?.label ?? k)}
                    </th>
                  ))}
                  <th className="py-1 text-right font-normal">Ждали</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row, i) => (
                  <tr key={String(row.label)} className="border-t">
                    <td className="py-1">{row.label}</td>
                    {keys.map((k) => (
                      <td key={k} className="py-1 text-right">
                        {Number(row[k]) || ''}
                      </td>
                    ))}
                    <td className="py-1 text-right">{history.days[i]?.waitMin || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      )}
    </Section>
  );
}

const ORIGIN: Record<QueueRowView['origin'], string> = {
  session: 'сессия',
  manual: 'запущено вручную',
  schedule: 'по расписанию',
  push: 'пуш без сессии',
};

function QueueNow({ queue }: { queue: BoardResponse['queue'] }) {
  const { act } = useBoardData();
  return (
    <section id="queue">
      <Section title="Очередь сейчас" aside={`идёт ${queue.running} · ждёт ${queue.waiting} · ${freeText(queue.freeSlotInMin)}`}>
        {queue.rows.length === 0 ? (
          <EmptyRow>Очередь пуста.</EmptyRow>
        ) : (
          <ul className="divide-y divide-border">
            {queue.rows.map((r) => (
              <QueueItem key={r.jobId} row={r} act={act} />
            ))}
          </ul>
        )}
      </Section>
    </section>
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
  const progress = running && row.estimateMin ? Math.min(100, Math.round(((row.elapsedMin ?? 0) / row.estimateMin) * 100)) : null;
  return (
    <li data-testid="queue-row" className="flex flex-col gap-1.5 px-4 py-3">
      <div className="flex items-start gap-2">
        <Chip tone={running ? 'strong' : 'plain'}>{running ? 'идёт' : 'ждёт'}</Chip>
        <p className="min-w-0 flex-1 text-sm">
          <span className="font-medium">{row.project}</span>{' '}
          <a href={row.runUrl} target="_blank" rel="noreferrer" className={link}>
            {row.workflow}
          </a>{' '}
          <span className="break-all text-muted-foreground">{row.branch}</span>
        </p>
      </div>
      {progress !== null && <Progress value={progress} aria-label="Сколько прошло от обычного времени сборки" />}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        <span>{timing}</span>
        {row.sessionUrl ? (
          <a href={row.sessionUrl} target="_blank" rel="noreferrer" className={link}>
            {row.sessionTitle ? `сессия «${row.sessionTitle}»` : 'сессия'}
          </a>
        ) : (
          <span>{row.origin === 'session' && row.sessionTitle ? `сессия «${row.sessionTitle}»` : ORIGIN[row.origin]}</span>
        )}
        {row.stale && <span className="rounded bg-warning/10 px-1.5 py-0.5 text-warning">устарел: есть сборка новее</span>}
        {(row.stale || !running) && (
          <span className="ml-auto">
            <SmallButton onClick={cancel}>отменить</SmallButton>
          </span>
        )}
      </div>
    </li>
  );
}
