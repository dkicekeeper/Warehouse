import { handleBoard } from '@/lib/api/owner-api';
import { ownerDeps } from '@/lib/api/owner-deps';

// Reads the request's cookie, so it is never prerendered or cached.
export async function GET(req: Request): Promise<Response> {
  return handleBoard(ownerDeps(req));
}
