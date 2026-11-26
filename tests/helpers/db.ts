import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { PgStore, type Sql } from '@/lib/store/pg';

const SCHEMA = readFileSync(new URL('../../supabase/migrations/0001_schema.sql', import.meta.url), 'utf8');

const TABLES = ['items', 'events', 'sources', 'jobs', 'runs', 'pull_requests', 'sessions', 'repos', 'projects', 'settings'];

let shared: PGlite | null = null;

/**
 * An in-process Postgres with the real schema, emptied before each use.
 * Starting one takes over a second, so a test file shares a single instance.
 */
export async function testStore(): Promise<{ store: PgStore; sql: Sql; close: () => Promise<void> }> {
  if (!shared) {
    shared = new PGlite();
    await shared.exec(SCHEMA);
  } else {
    await shared.exec(`truncate ${TABLES.join(', ')} cascade; insert into settings (id) values (1);`);
  }
  const db = shared;
  const sql: Sql = { query: async (text, params = []) => (await db.query(text, params)).rows as never };
  return { store: new PgStore(sql), sql, close: async () => {} };
}
