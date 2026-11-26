import { after } from 'next/server';
import { handleBacklog } from '@/lib/api/owner-api';
import { ownerDeps } from '@/lib/api/owner-deps';
import { heartbeat } from '@/lib/runtime';

// Reads the request's cookie, so it is never prerendered or cached.
export async function GET(req: Request): Promise<Response> {
  const res = await handleBacklog(ownerDeps(req));
  if (res.ok) after(heartbeat);
  return res;
}
