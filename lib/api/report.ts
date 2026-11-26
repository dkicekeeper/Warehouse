import type { z } from 'zod';
import { verifyBearer } from '@/lib/auth/bearer';
import { applyReconcileBatch, applySessionReport, ReconcileBatch, SessionReport } from '@/lib/ingest/sessions';
import type { SourceName, Store } from '@/lib/store/store';

export interface ReportDeps {
  store: Store;
  now: Date;
  token: string;
  /** Runs after the report is stored; its failure must not fail the request. */
  afterIngest: () => Promise<unknown>;
}

const empty = (status: number) => new Response(null, { status });

async function handle<S extends z.ZodTypeAny>(
  req: Request,
  deps: ReportDeps,
  schema: S,
  source: SourceName,
  apply: (store: Store, body: z.infer<S>, now: Date) => Promise<void>,
): Promise<Response> {
  if (!verifyBearer(req, deps.token)) return empty(401);
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return empty(400);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return empty(400);
  try {
    await apply(deps.store, parsed.data, deps.now);
    await deps.store.touchSource(source, deps.now, true);
  } catch (err) {
    await deps.store.touchSource(source, deps.now, false, err instanceof Error ? err.message : 'ошибка').catch(() => {});
    return empty(500);
  }
  await deps.afterIngest().catch(() => {});
  return empty(204);
}

export const handleSessionReport = (req: Request, deps: ReportDeps) =>
  handle(req, deps, SessionReport, 'session_hook', applySessionReport);

export const handleReconcile = (req: Request, deps: ReportDeps) =>
  handle(req, deps, ReconcileBatch, 'reconcile', applyReconcileBatch);
