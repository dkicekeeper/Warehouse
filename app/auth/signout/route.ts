import { handleSignout } from '@/lib/api/auth';
import { isLiveOwner } from '@/lib/api/owner-deps';
import { authConfig } from '@/lib/auth/config';
import { getStore } from '@/lib/store/db';

/**
 * Signing out ends every session issued so far, on every device: the cookie cannot be recalled
 * from a browser that copied it, so the server stops honouring anything older than this moment.
 */
export async function POST(req: Request): Promise<Response> {
  const store = getStore();
  if (await isLiveOwner(req, store).catch(() => false)) {
    await store.patchSettings({ sessionsValidAfter: new Date() }).catch(() => {});
  }
  return handleSignout(authConfig());
}
