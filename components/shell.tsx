'use client';

import { BookOpen, FolderKanban, LayoutDashboard, ListTodo, LineChart, Settings } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { cn } from '@/lib/utils';
import { kpis } from '@/lib/domain/overview';
import { useBoardData } from './board-data';
import { secondsAgo } from './format';

/**
 * The frame of every signed-in page: a sidebar with the sections and the projects on a wide
 * screen, a tab bar at the bottom on a phone, and how fresh the data is at the top.
 */

const NAV = [
  { href: '/', label: 'Обзор', short: 'Обзор', icon: LayoutDashboard },
  { href: '/projects', label: 'Проекты', short: 'Проекты', icon: FolderKanban },
  { href: '/backlog', label: 'Задачи и планы', short: 'Задачи', icon: ListTodo },
  { href: '/metrics', label: 'Метрики', short: 'Метрики', icon: LineChart },
  { href: '/guides', label: 'Гайдлайны', short: 'Правила', icon: BookOpen },
  { href: '/settings', label: 'Настройки', short: 'Настройки', icon: Settings },
] as const;

function Count({ n, strong }: { n: number; strong?: boolean }) {
  if (n <= 0) return null;
  return (
    <span
      className={cn(
        'ml-auto min-w-5 rounded-full px-1.5 text-center text-xs font-medium tabular-nums leading-5',
        strong ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
      )}
    >
      {n}
    </span>
  );
}

function Freshness() {
  const { board, offline, now } = useBoardData();
  return (
    <span data-testid="freshness" className={cn('text-xs', offline ? 'text-destructive' : 'text-muted-foreground')}>
      {offline ? 'нет связи · ' : ''}
      {board ? secondsAgo(board.generatedAt, now ?? new Date(board.generatedAt)) : offline ? '' : 'загрузка…'}
    </span>
  );
}

function Sidebar() {
  const path = usePathname();
  const params = useSearchParams();
  const { board } = useBoardData();
  const k = board ? kpis(board) : null;
  const counts: Record<string, number> = { '/': k ? k.requests + k.ownerTasks : 0, '/backlog': k?.ownerTasks ?? 0 };
  const selected = path === '/backlog' ? params.get('project') : null;
  const projects = (board?.projects ?? []).filter((p) => p.id);

  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-6 border-r bg-sidebar px-3 py-4 text-sidebar-foreground lg:flex">
      <Link href="/" className="px-2 text-base font-semibold tracking-tight">
        Warehouse
      </Link>
      <nav aria-label="Разделы" className="flex flex-col gap-0.5">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? path === '/' : path.startsWith(href) && !(href === '/backlog' && selected);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex h-9 items-center gap-2.5 rounded-md px-2 text-sm hover:bg-sidebar-accent',
                active && 'bg-sidebar-accent font-medium text-sidebar-accent-foreground',
              )}
            >
              <Icon className="size-4 text-muted-foreground" aria-hidden />
              {label}
              <Count n={counts[href] ?? 0} strong={href === '/'} />
            </Link>
          );
        })}
      </nav>
      {projects.length > 0 && (
        <nav aria-label="Проекты" className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
          <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">Проекты</p>
          {projects.map((p) => {
            const tasks = (p.id && board?.backlog?.byProject[p.id]?.needsOwner) || 0;
            return (
              <Link
                key={p.id}
                href={`/backlog?project=${encodeURIComponent(p.id ?? '')}`}
                aria-current={selected === p.id ? 'page' : undefined}
                className={cn(
                  'flex h-8 items-center gap-2 rounded-md px-2 text-sm hover:bg-sidebar-accent',
                  selected === p.id && 'bg-sidebar-accent font-medium',
                )}
              >
                <span className="truncate">{p.name}</span>
                <Count n={p.waiting + tasks} />
              </Link>
            );
          })}
        </nav>
      )}
      <div className="mt-auto px-2">
        <Freshness />
      </div>
    </aside>
  );
}

function TabBar() {
  const path = usePathname();
  const { board } = useBoardData();
  const k = board ? kpis(board) : null;
  return (
    <nav
      aria-label="Разделы"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      {NAV.map(({ href, short, icon: Icon }) => {
        const active = href === '/' ? path === '/' : path.startsWith(href);
        const n = href === '/' && k ? k.requests + k.ownerTasks : 0;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn('relative flex h-14 flex-col items-center justify-center gap-0.5 text-[11px]', active ? 'text-foreground' : 'text-muted-foreground')}
          >
            <Icon className="size-5" aria-hidden />
            {short}
            {n > 0 && (
              <span className="absolute left-1/2 top-1.5 ml-2 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] font-medium leading-4 text-primary-foreground">
                {n}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <Suspense>
        <Sidebar />
      </Suspense>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 items-center justify-between gap-3 border-b px-4 lg:hidden">
          <Link href="/" className="font-semibold tracking-tight">
            Warehouse
          </Link>
          <Freshness />
        </header>
        <main className="min-w-0 flex-1 pb-20 lg:pb-0">{children}</main>
      </div>
      <TabBar />
    </div>
  );
}
