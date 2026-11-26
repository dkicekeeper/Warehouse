import { handleCancelRun } from '@/lib/api/owner-api';
import { ownerDeps } from '@/lib/api/owner-deps';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return handleCancelRun((await params).id, ownerDeps(req));
}
