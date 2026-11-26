import { connection } from 'next/server';
import { handleSettingsGet, handleSettingsPost } from '@/lib/api/owner-api';
import { ownerDeps } from '@/lib/api/owner-deps';

export async function GET(): Promise<Response> {
  // Never prerendered or cached: the answer depends on who is asking and on the minute.
  await connection();
  return handleSettingsGet(ownerDeps());
}

export async function POST(req: Request): Promise<Response> {
  return handleSettingsPost(req, ownerDeps());
}
