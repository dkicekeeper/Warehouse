import { handleSettingsGet, handleSettingsPost } from '@/lib/api/owner-api';
import { ownerDeps } from '@/lib/api/owner-deps';

export async function GET(req: Request): Promise<Response> {
  return handleSettingsGet(ownerDeps(req));
}

export async function POST(req: Request): Promise<Response> {
  return handleSettingsPost(req, ownerDeps(req));
}
