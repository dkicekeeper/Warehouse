/** The parts of a Supabase user the owner check reads. */
export interface AuthUser {
  identities?: { provider?: string; identity_data?: Record<string, unknown> | null }[] | null;
}

/**
 * True for the one GitHub account allowed in.
 * Only `identities` is trusted: it comes from GitHub at sign-in. `user_metadata` carries the same
 * id, but a signed-in user can rewrite their own metadata, so it proves nothing.
 */
export function isOwnerUser(user: AuthUser | null | undefined, ownerGithubId: string): boolean {
  if (!ownerGithubId || !user?.identities) return false;
  return user.identities.some((i) => {
    if (i.provider !== 'github') return false;
    const sub = i.identity_data?.sub ?? i.identity_data?.provider_id;
    return sub !== undefined && sub !== null && String(sub) === ownerGithubId;
  });
}
