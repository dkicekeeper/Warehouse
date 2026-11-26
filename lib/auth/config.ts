import type { AuthConfig } from '@/lib/api/auth';

/** Sign-in settings from the environment. Missing values make every check fail closed. */
export const authConfig = (): AuthConfig => ({
  clientId: process.env.GITHUB_APP_CLIENT_ID ?? '',
  clientSecret: process.env.GITHUB_APP_CLIENT_SECRET ?? '',
  sessionSecret: process.env.SESSION_SECRET ?? '',
  ownerGithubId: process.env.OWNER_GITHUB_ID ?? '',
  baseUrl: (process.env.PUBLIC_BASE_URL ?? '').replace(/\/$/, ''),
  now: new Date(),
});
