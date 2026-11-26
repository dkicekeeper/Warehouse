import { githubApp } from '@/lib/github/app';
import { recompute, type Notifier, type RecomputeResult } from '@/lib/recompute';
import { getStore } from '@/lib/store/db';

/** Used until a Telegram bot is configured; nothing is sent while no chat is bound anyway. */
const noNotifier: Notifier = {
  send: async () => {
    throw new Error('Telegram не настроен');
  },
  edit: async () => {
    throw new Error('Telegram не настроен');
  },
};

let notifierFactory: () => Notifier = () => noNotifier;

/** Lets the Telegram module plug itself in without this file importing it. */
export function setNotifierFactory(factory: () => Notifier): void {
  notifierFactory = factory;
}

export const baseUrl = () => (process.env.PUBLIC_BASE_URL ?? '').replace(/\/$/, '');

export function runRecompute(now: Date = new Date()): Promise<RecomputeResult> {
  return recompute(getStore(), { now, notifier: notifierFactory(), baseUrl: baseUrl() });
}

export async function enrichPr(repo: string, number: number): Promise<void> {
  await githubApp()?.enrichPr(getStore(), repo, number);
}
