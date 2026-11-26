import postgres from 'postgres';
import { PgStore, type Sql } from './pg';
import type { Store } from './store';

let cached: Store | null = null;

/**
 * The production store: a direct Postgres connection (Supabase's transaction pooler).
 * `prepare: false` because the pooler does not keep prepared statements between calls.
 *
 * Nothing connects, or even looks at the configuration, until the first query: every endpoint
 * decides whether to answer at all before it touches the database, and a missing setting must
 * not turn that refusal into a server error.
 */
export function getStore(): Store {
  if (cached) return cached;
  let client: ReturnType<typeof postgres> | null = null;
  const sql: Sql = {
    query: async (text, params = []) => {
      if (!client) {
        const url = process.env.DATABASE_URL;
        if (!url) throw new Error('DATABASE_URL is not set');
        client = postgres(url, { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 10 });
      }
      return (await client.unsafe(text, params as never[])) as never;
    },
  };
  cached = new PgStore(sql);
  return cached;
}
