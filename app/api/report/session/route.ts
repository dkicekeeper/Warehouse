import { after } from 'next/server';
import { handleSessionReport } from '@/lib/api/report';
import { heartbeat, runRecompute } from '@/lib/runtime';
import { getStore } from '@/lib/store/db';

export async function POST(req: Request): Promise<Response> {
  const res = await handleSessionReport(req, {
    store: getStore(),
    now: new Date(),
    token: process.env.REPORT_TOKEN ?? '',
    afterIngest: () => runRecompute(),
  });
  if (res.ok) after(heartbeat);
  return res;
}
