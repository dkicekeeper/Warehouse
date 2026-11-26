import { handleTick } from '@/lib/api/tick';
import { githubApp } from '@/lib/github/app';
import { runRecompute } from '@/lib/runtime';
import { getSql, getStore } from '@/lib/store/db';
import { migrate } from '@/lib/store/migrations';

// Per server instance: once the schema is known to be current, stop asking.
let migrated = false;

// A resync reads every repository; give it room.
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  const now = new Date();
  return handleTick(req, {
    store: getStore(),
    now,
    token: process.env.CRON_TOKEN ?? '',
    github: githubApp(),
    recompute: () => runRecompute(now),
    migrate: async () => {
      if (migrated) return [];
      const applied = await migrate(getSql());
      migrated = true;
      return applied;
    },
  });
}
