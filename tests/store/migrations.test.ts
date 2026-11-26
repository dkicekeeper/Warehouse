import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';
import { MIGRATIONS, migrate } from '@/lib/store/migrations';
import { PgStore, type Sql } from '@/lib/store/pg';
import { DEFAULT_SETTINGS } from '@/lib/domain/types';

function fresh(): Sql {
  const db = new PGlite();
  return {
    query: async (text, params = []) => (await db.query(text, params)).rows as never,
    exec: async (text) => {
      await db.exec(text);
    },
  };
}

it('brings an empty database to the current schema, with the seeded projects', async () => {
  const sql = fresh();
  expect(await migrate(sql)).toEqual(MIGRATIONS.map((m) => m.name));
  const store = new PgStore(sql);
  expect(await store.getSettings()).toEqual(DEFAULT_SETTINGS);
  const snap = await store.loadSnapshot(new Date());
  expect(snap.projects.map((p) => p.name).sort()).toEqual(['Baja.kz', 'Tenra']);
});

it('running it again applies nothing and changes nothing', async () => {
  const sql = fresh();
  await migrate(sql);
  expect(await migrate(sql)).toEqual([]);
  expect((await new PgStore(sql).loadSnapshot(new Date())).projects).toHaveLength(2);
});

it('a migration that fails leaves no trace and can be retried', async () => {
  const sql = fresh();
  const broken = [...MIGRATIONS.slice(0, 1), { name: '9999_broken', sql: 'create table half_done (id int); select nope();' }];
  await expect(migrate(sql, broken)).rejects.toThrow();
  const [row] = await sql.query<{ n: number }>(`select count(*)::int as n from information_schema.tables where table_name = 'half_done'`);
  expect(row?.n).toBe(0);
  expect(await migrate(sql)).toEqual(MIGRATIONS.slice(1).map((m) => m.name));
});

it('migration names are unique and ordered', () => {
  const names = MIGRATIONS.map((m) => m.name);
  expect([...names].sort()).toEqual(names);
  expect(new Set(names).size).toBe(names.length);
});
