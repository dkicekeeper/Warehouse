import { handleLogin } from '@/lib/api/auth';
import { authConfig } from '@/lib/auth/config';

export async function GET(): Promise<Response> {
  return handleLogin(authConfig());
}
