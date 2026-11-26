import { connection } from 'next/server';
import { handleBoard } from '@/lib/api/owner-api';
import { ownerDeps } from '@/lib/api/owner-deps';

export async function GET(): Promise<Response> {
  // Never prerendered or cached: the answer depends on who is asking and on the minute.
  await connection();
  return handleBoard(ownerDeps());
}
