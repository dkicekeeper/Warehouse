import { PGlite } from '@electric-sql/pglite';
import { postgresSql } from '@/lib/store/db';
import { MIGRATIONS } from '@/lib/store/migrations';
import { PgStore, type Sql } from '@/lib/store/pg';

/** The schema alone; tests seed their own projects. */
const SCHEMA = MIGRATIONS[0]?.sql ?? '';

const TABLES = ['items', 'events', 'sources', 'jobs', 'runs', 'pull_requests', 'sessions', 'repos', 'projects', 'settings'];
const RESET = `truncate ${TABLES.join(', ')} cascade; insert into settings (id) values (1);`;

let shared: { sql: Sql; exec: (text: string) => Promise<unknown> } | null = null;

/**
 * A Postgres with the real schema, emptied before each use.
 *
 * By default it is PGlite, in-process, so the suite needs nothing installed. With
 * TEST_DATABASE_URL set it is a real server reached through postgres.js exactly as production
 * reaches it — the two drivers encode parameters differently, and only this run proves the SQL
 * works with the one that ships. CI runs both.
 */
export async function testStore(): Promise<{ store: PgStore; sql: Sql; close: () => Promise<void> }> {
  if (!shared) {
    const url = process.env.TEST_DATABASE_URL;
    if (url) {
      const sql = postgresSql(() => url);
      const exec = (text: string) => sql.exec(text);
      await exec('drop schema if exists public cascade; create schema public;');
      await exec(SCHEMA);
      shared = { sql, exec };
    } else {
      const db = new PGlite();
      await db.exec(SCHEMA);
      shared = {
        sql: {
          query: async (text, params = []) => (await db.query(text, params)).rows as never,
          exec: async (text) => {
            await db.exec(text);
          },
        },
        exec: (text) => db.exec(text),
      };
    }
  } else {
    await shared.exec(RESET);
  }
  return { store: new PgStore(shared.sql), sql: shared.sql, close: async () => {} };
}
