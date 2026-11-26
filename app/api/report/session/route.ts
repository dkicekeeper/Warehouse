import { handleSessionReport } from '@/lib/api/report';
import { runRecompute } from '@/lib/runtime';
import { getStore } from '@/lib/store/db';

export async function POST(req: Request): Promise<Response> {
  return handleSessionReport(req, {
    store: getStore(),
    now: new Date(),
    token: process.env.REPORT_TOKEN ?? '',
    afterIngest: () => runRecompute(),
  });
}
