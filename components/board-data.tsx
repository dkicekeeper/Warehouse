'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { BoardResponse } from '@/lib/domain/overview';

/**
 * The board, fetched once for every page of the service: the shell counts from it, the overview
 * and the projects page draw it. Polls every 15 s and on return to the tab.
 */

const POLL_MS = 15_000;

export type Act = (url: string, body?: unknown) => Promise<void>;

interface BoardData {
  board: BoardResponse | null;
  offline: boolean;
  now: Date | null;
  error: string | null;
  act: Act;
}

const Ctx = createContext<BoardData | null>(null);

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

export function BoardProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<{ board: BoardResponse | null; offline: boolean }>({ board: null, offline: false });
  const [now, setNow] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/board', { cache: 'no-store' });
      if (res.status === 401) {
        router.replace('/login');
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const board = (await res.json()) as BoardResponse;
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

  const act = useCallback<Act>(
    async (url, body) => {
      setError(await post(url, body));
      await load();
    },
    [load],
  );

  return <Ctx.Provider value={{ ...state, now, error, act }}>{children}</Ctx.Provider>;
}

export function useBoardData(): BoardData {
  const data = useContext(Ctx);
  if (!data) throw new Error('useBoardData outside BoardProvider');
  return data;
}

/** Whether the screen is at least as wide as a tablet held sideways; false before hydration. */
export function useWide(query = '(min-width: 768px)'): boolean {
  return useSyncExternalStore(
    (change) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', change);
      return () => m.removeEventListener('change', change);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
