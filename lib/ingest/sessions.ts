import { z } from 'zod';
import { parseStatusLine } from '@/lib/domain/status-line';
import type { SessionPatch, Store } from '@/lib/store/store';

/** What the Stop hook of a session sends at the end of every turn. */
export const SessionReport = z.object({
  session_id: z.string().min(1).max(200),
  repo: z
    .string()
    .max(200)
    .regex(/^[\w.-]+\/[\w.-]+$/)
    .nullable(),
  branch: z.string().max(300).nullable(),
  message_tail: z.string().max(4000),
  sent_at: z.string().datetime({ offset: true }),
});
export type SessionReport = z.infer<typeof SessionReport>;

const SUMMARY_MAX = 600;

/** What the hourly scheduled task sends: the session list as the Claude app shows it. */
export const ReconcileBatch = z.object({
  sessions: z
    .array(
      z.object({
        session_id: z.string().min(1).max(200),
        title: z.string().max(500).nullable(),
        archived: z.boolean(),
        bucket: z.enum(['working', 'blocked', 'review_ready', 'completed', 'failed']),
        unread: z.boolean(),
        summary: z
          .string()
          .nullable()
          .transform((s) => (s === null ? null : s.slice(0, SUMMARY_MAX))),
        updated_at: z.string().datetime({ offset: true }),
      }),
    )
    .max(500),
});
export type ReconcileBatch = z.infer<typeof ReconcileBatch>;

/**
 * A session says how its turn ended. Only the parsed state and its one line are kept; the rest of
 * the message never reaches the database.
 */
export async function applySessionReport(store: Store, r: SessionReport, now: Date): Promise<void> {
  const status = parseStatusLine(r.message_tail);
  const patch: SessionPatch = {
    id: r.session_id,
    repo: r.repo,
    branch: r.branch,
    state: status.state,
    stateText: status.text,
    // The server's clock, not the sender's: "работаю" expires by this time.
    reportedAt: now,
    archived: false,
  };
  const repo = r.repo ? await store.getRepo(r.repo) : null;
  if (repo) patch.projectId = repo.projectId;
  await store.upsertSession(patch);
  await linkSessionToPr(store, r.session_id);
}

/** The hook knows best how a turn ended, so the list only fills in what the hook cannot see. */
export async function applyReconcileBatch(store: Store, batch: ReconcileBatch): Promise<void> {
  for (const s of batch.sessions) {
    await store.upsertSession({
      id: s.session_id,
      title: s.title,
      archived: s.archived,
      reconcile: { bucket: s.bucket, unread: s.unread, summary: s.summary, updatedAt: new Date(s.updated_at) },
    });
  }
  await store.adoptSessionsFromPrs();
}

/** The open pull request on the session's branch is the session's, unless a commit already named another. */
export async function linkSessionToPr(store: Store, sessionId: string): Promise<void> {
  const session = await store.getSession(sessionId);
  if (!session?.repo || !session.branch) return;
  const pr = await store.findOpenPr(session.repo, session.branch);
  if (pr && pr.sessionId === null) await store.upsertPr({ ...pr, sessionId });
}
