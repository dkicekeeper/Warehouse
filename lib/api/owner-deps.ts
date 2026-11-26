import { ownerSession } from '@/lib/api/auth';
import { authConfig } from '@/lib/auth/config';
import { githubApp } from '@/lib/github/app';
import { getStore } from '@/lib/store/db';
import type { Store } from '@/lib/store/store';
import type { OwnerDeps } from './owner-api';

/** A valid owner session that no sign-out has ended since it was issued. */
export async function isLiveOwner(req: Request, store: Store): Promise<boolean> {
  const session = ownerSession(req, authConfig());
  if (!session) return false;
  const { sessionsValidAfter } = await store.getSettings();
  return !sessionsValidAfter || session.issuedAt.getTime() >= sessionsValidAfter.getTime();
}

export const ownerDeps = (req: Request): OwnerDeps => {
  const store = getStore();
  return { store, now: new Date(), isOwner: () => isLiveOwner(req, store), github: githubApp() };
};
