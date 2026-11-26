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

it('after a failed migration the same connection still works', async () => {
  const sql = fresh();
  await expect(migrate(sql, [{ name: '9999_broken', sql: 'select nope();' }])).rejects.toThrow();
  expect(await sql.query('select 1 as ok')).toEqual([{ ok: 1 }]);
});

it('two runs at once apply each migration once and neither fails', async () => {
  const sql = fresh();
  const [a, b] = await Promise.all([migrate(sql), migrate(sql)]);
  expect([...a, ...b].sort()).toEqual(MIGRATIONS.map((m) => m.name));
  expect((await new PgStore(sql).loadSnapshot(new Date())).projects).toHaveLength(2);
});

it('migration names are unique and ordered', () => {
  const names = MIGRATIONS.map((m) => m.name);
  expect([...names].sort()).toEqual(names);
  expect(new Set(names).size).toBe(names.length);
});

// The same guarantees through the production driver, where connections are pooled and truly
// concurrent. Runs when a real server is given (CI does).
it.skipIf(!process.env.TEST_DATABASE_URL)('on a real server: concurrent first runs, a failure, and a repeat', async () => {
  const { postgresSql } = await import('@/lib/store/db');
  const sql = postgresSql(() => process.env.TEST_DATABASE_URL);
  await sql.exec('drop schema if exists public cascade; create schema public;');
  const runs = await Promise.all([migrate(sql), migrate(sql), migrate(sql)]);
  expect(runs.flat().sort()).toEqual(MIGRATIONS.map((m) => m.name));
  expect(await migrate(sql)).toEqual([]);
  const broken = [...MIGRATIONS, { name: '9999_broken', sql: 'create table half_done (id int); perform nope();' }];
  await expect(migrate(sql, broken)).rejects.toThrow();
  // Every pooled connection still answers after the failure.
  const answers = await Promise.all(Array.from({ length: 8 }, () => sql.query<{ ok: number }>('select 1 as ok')));
  expect(answers.every((a) => a[0]?.ok === 1)).toBe(true);
  const [row] = await sql.query<{ n: number }>(`select count(*)::int as n from information_schema.tables where table_name = 'half_done'`);
  expect(row?.n).toBe(0);
  await sql.end();
});
