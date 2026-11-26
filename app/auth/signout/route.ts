import { handleSignout } from '@/lib/api/auth';
import { authConfig } from '@/lib/auth/config';

export async function POST(): Promise<Response> {
  return handleSignout(authConfig());
}
