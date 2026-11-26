import postgres from 'postgres';
import { PgStore, type Sql } from './pg';
import type { Store } from './store';

let cached: Store | null = null;

/**
 * The production store: a direct Postgres connection (Supabase's transaction pooler).
 * `prepare: false` because the pooler does not keep prepared statements between calls.
 */
export function getStore(): Store {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const client = postgres(url, { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 10 });
  const sql: Sql = {
    query: async (text, params = []) => (await client.unsafe(text, params as never[])) as never,
  };
  cached = new PgStore(sql);
  return cached;
}
