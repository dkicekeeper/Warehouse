import { handleCallback } from '@/lib/api/auth';
import { authConfig } from '@/lib/auth/config';

export async function GET(req: Request): Promise<Response> {
  return handleCallback(req, authConfig());
}
