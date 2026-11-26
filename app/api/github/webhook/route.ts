import { after } from 'next/server';
import { handleGithubWebhook } from '@/lib/api/github-webhook';
import { enrichPr, heartbeat, runRecompute } from '@/lib/runtime';
import { getStore } from '@/lib/store/db';

export async function POST(req: Request): Promise<Response> {
  const res = await handleGithubWebhook(req, {
    store: getStore(),
    now: new Date(),
    secret: process.env.GITHUB_WEBHOOK_SECRET ?? '',
    afterIngest: () => runRecompute(),
    enrichPr,
  });
  if (res.ok) after(heartbeat);
  return res;
}
