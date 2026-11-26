import { after } from 'next/server';
import { handleBoard } from '@/lib/api/owner-api';
import { ownerDeps } from '@/lib/api/owner-deps';
import { heartbeat } from '@/lib/runtime';

// Reads the request's cookie, so it is never prerendered or cached.
export async function GET(req: Request): Promise<Response> {
  const res = await handleBoard(ownerDeps(req));
  // An open board is a clock: while the owner is looking, the service keeps itself current.
  if (res.ok) after(heartbeat);
  return res;
}
