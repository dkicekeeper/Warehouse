import postgres from 'postgres';
import { PgStore, type Sql } from './pg';
import type { Store } from './store';

/**
 * The store's view of a postgres.js connection. `prepare: false` because Supabase's transaction
 * pooler does not keep prepared statements between calls.
 *
 * Nothing connects, or even looks at the URL, until the first query: every endpoint decides
 * whether to answer at all before it touches the database, and a missing setting must not turn
 * that refusal into a server error.
 */
export function postgresSql(url: () => string | undefined): Sql & { end: () => Promise<void> } {
  let client: ReturnType<typeof postgres> | null = null;
  return {
    query: async (text, params = []) => {
      if (!client) {
        const value = url();
        if (!value) throw new Error('DATABASE_URL is not set');
        client = postgres(value, { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 10, onnotice: () => {} });
      }
      return (await client.unsafe(text, params as never[])) as never;
    },
    end: async () => {
      await client?.end();
      client = null;
    },
  };
}

let cached: Store | null = null;

/** The production store. */
export function getStore(): Store {
  cached ??= new PgStore(postgresSql(() => process.env.DATABASE_URL));
  return cached;
}
