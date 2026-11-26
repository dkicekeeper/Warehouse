import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { testStore } from '../helpers/db';
import { NOW } from '../helpers/factories';

const SEED = readFileSync(new URL('../../supabase/migrations/0003_seed_projects.sql', import.meta.url), 'utf8');

it('the seed names Baja.kz and puts both Tenra repositories in one project', async () => {
  const { store, sql } = await testStore();
  for (const statement of SEED.split(/;\s*\n/).filter((s) => s.replace(/--.*$/gm, '').trim())) await sql.query(statement);
  const snap = await store.loadSnapshot(NOW);
  const name = (repo: string) => snap.projects.find((p) => p.id === snap.repos.find((r) => r.fullName === repo)?.projectId)?.name;
  expect(name('dkicekeeper/AutoParts4x4')).toBe('Baja.kz');
  expect(name('dkicekeeper/Tenra')).toBe('Tenra');
  expect(name('dkicekeeper/tenra-assets')).toBe('Tenra');
  expect(snap.projects).toHaveLength(2);
  // A webhook for a seeded repository keeps the seeded project.
  const again = await store.ensureRepo('dkicekeeper/AutoParts4x4', 'main', 'AutoParts4x4');
  expect(snap.projects.find((p) => p.id === again.projectId)?.name).toBe('Baja.kz');
});
