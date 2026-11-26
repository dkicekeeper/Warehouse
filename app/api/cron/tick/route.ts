import { handleTick } from '@/lib/api/tick';
import { tickDeps } from '@/lib/runtime';

// A resync reads every repository; give it room.
export const maxDuration = 60;

/** The GitHub Actions schedule (.github/workflows/tick.yml) calls this with CRON_TOKEN. */
export async function POST(req: Request): Promise<Response> {
  return handleTick(req, { ...tickDeps(), token: process.env.CRON_TOKEN ?? '' });
}

/**
 * Vercel's own cron (vercel.json) calls this twice a day with CRON_SECRET. It is too rare to be the
 * clock, but it guarantees the morning digest on a day when nothing else happens.
 */
export async function GET(req: Request): Promise<Response> {
  return handleTick(req, { ...tickDeps(), token: process.env.CRON_SECRET ?? '' });
}
