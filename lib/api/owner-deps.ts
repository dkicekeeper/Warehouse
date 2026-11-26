import { isOwner } from '@/lib/auth/server';
import { githubApp } from '@/lib/github/app';
import { getStore } from '@/lib/store/db';
import type { OwnerDeps } from './owner-api';

export const ownerDeps = (): OwnerDeps => ({ store: getStore(), now: new Date(), isOwner, github: githubApp() });
