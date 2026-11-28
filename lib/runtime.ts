import { tickIfDue, type TickDeps } from '@/lib/api/tick';
import { githubApp } from '@/lib/github/app';
import { metricClients } from '@/lib/metrics/collect';
import { recompute, type Notifier, type RecomputeResult } from '@/lib/recompute';
import { getSql, getStore } from '@/lib/store/db';
import { migrate } from '@/lib/store/migrations';
import { telegramNotifier } from '@/lib/telegram/client';

/** Used while no Telegram bot is configured; nothing is sent while no chat is bound anyway. */
const noNotifier: Notifier = {
  send: async () => {
    throw new Error('Telegram не настроен');
  },
  edit: async () => {
    throw new Error('Telegram не настроен');
  },
};

function notifier(): Notifier {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  return token ? telegramNotifier(token) : noNotifier;
}

export const baseUrl = () => (process.env.PUBLIC_BASE_URL ?? '').replace(/\/$/, '');

export function runRecompute(now: Date = new Date()): Promise<RecomputeResult> {
  return recompute(getStore(), { now, notifier: notifier(), baseUrl: baseUrl() });
}

export async function enrichPr(repo: string, number: number): Promise<void> {
  await githubApp()?.enrichPr(getStore(), repo, number);
}

// Per server instance: once the schema is known to be current, stop asking.
let migrated = false;

/** Everything a tick needs, for the scheduled endpoint and for the heartbeat alike. */
export function tickDeps(now: Date = new Date()): Omit<TickDeps, 'token'> {
  return {
    store: getStore(),
    now,
    github: githubApp(),
    recompute: () => runRecompute(now),
    metrics: metricClients(),
    migrate: async () => {
      if (migrated) return [];
      const applied = await migrate(getSql());
      migrated = true;
      return applied;
    },
  };
}

/** Offers the service a tick after the current response has gone out. */
export const heartbeat = (): Promise<boolean> => tickIfDue(tickDeps());
