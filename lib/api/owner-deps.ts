import { isOwnerRequest } from '@/lib/api/auth';
import { authConfig } from '@/lib/auth/config';
import { githubApp } from '@/lib/github/app';
import { getStore } from '@/lib/store/db';
import type { OwnerDeps } from './owner-api';

export const ownerDeps = (req: Request): OwnerDeps => ({
  store: getStore(),
  now: new Date(),
  isOwner: async () => isOwnerRequest(req, authConfig()),
  github: githubApp(),
});
