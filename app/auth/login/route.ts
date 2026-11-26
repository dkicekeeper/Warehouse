import { connection } from 'next/server';
import { handleLogin } from '@/lib/api/auth';
import { authConfig } from '@/lib/auth/config';

export async function GET(): Promise<Response> {
  // Each visitor needs a state of their own; this must never be prerendered into the build.
  await connection();
  return handleLogin(authConfig());
}
