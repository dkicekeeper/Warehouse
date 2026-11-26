import { handleGithubWebhook } from '@/lib/api/github-webhook';
import { enrichPr, runRecompute } from '@/lib/runtime';
import { getStore } from '@/lib/store/db';

export async function POST(req: Request): Promise<Response> {
  return handleGithubWebhook(req, {
    store: getStore(),
    now: new Date(),
    secret: process.env.GITHUB_WEBHOOK_SECRET ?? '',
    afterIngest: () => runRecompute(),
    enrichPr,
  });
}
