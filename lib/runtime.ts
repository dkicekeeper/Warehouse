import { githubApp } from '@/lib/github/app';
import { recompute, type Notifier, type RecomputeResult } from '@/lib/recompute';
import { getStore } from '@/lib/store/db';
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
