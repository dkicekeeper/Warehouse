import { describe, expect, it } from 'vitest';
import { isOwnerUser } from '@/lib/auth/owner';

const OWNER = '1234567';
const user = (over: Record<string, unknown> = {}) => ({
  id: 'uuid-1',
  app_metadata: { provider: 'github' },
  user_metadata: { provider_id: OWNER, user_name: 'owner' },
  identities: [{ provider: 'github', identity_data: { sub: OWNER, provider_id: OWNER } }],
  ...over,
});

describe('isOwnerUser', () => {
  it('accepts the GitHub account whose id is configured', () => {
    expect(isOwnerUser(user(), OWNER)).toBe(true);
  });

  it('rejects another GitHub account', () => {
    const other = user({ identities: [{ provider: 'github', identity_data: { sub: '999' } }], user_metadata: { provider_id: '999' } });
    expect(isOwnerUser(other, OWNER)).toBe(false);
  });

  it('is not fooled by user_metadata, which a signed-in user can edit themselves', () => {
    const spoof = user({ identities: [{ provider: 'github', identity_data: { sub: '999' } }], user_metadata: { provider_id: OWNER, sub: OWNER } });
    expect(isOwnerUser(spoof, OWNER)).toBe(false);
  });

  it('rejects the same id coming from another provider', () => {
    expect(isOwnerUser(user({ identities: [{ provider: 'gitlab', identity_data: { sub: OWNER } }] }), OWNER)).toBe(false);
  });

  it('rejects nobody, a user without identities, and everything when no owner is configured', () => {
    expect(isOwnerUser(null, OWNER)).toBe(false);
    expect(isOwnerUser(user({ identities: undefined }), OWNER)).toBe(false);
    expect(isOwnerUser(user({ identities: [] }), OWNER)).toBe(false);
    expect(isOwnerUser(user(), '')).toBe(false);
    expect(isOwnerUser(user({ identities: [{ provider: 'github', identity_data: { sub: '' } }] }), '')).toBe(false);
  });

  it('compares a numeric id from the provider as text', () => {
    expect(isOwnerUser(user({ identities: [{ provider: 'github', identity_data: { sub: 1234567 } }] }), OWNER)).toBe(true);
  });
});
