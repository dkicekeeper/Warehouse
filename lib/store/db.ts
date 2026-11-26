import postgres from 'postgres';
import { PgStore, type Sql } from './pg';
import type { Store } from './store';

/**
 * The store's view of a postgres.js connection. `prepare: false` because a transaction-mode
 * pooler (Neon's, Supabase's) does not keep prepared statements between calls.
 *
 * Nothing connects, or even looks at the URL, until the first query: every endpoint decides
 * whether to answer at all before it touches the database, and a missing setting must not turn
 * that refusal into a server error.
 */
export function postgresSql(url: () => string | undefined): Sql & { end: () => Promise<void> } {
  let client: ReturnType<typeof postgres> | null = null;
  const connect = () => {
    if (!client) {
      const value = url();
      if (!value) throw new Error('DATABASE_URL is not set');
      client = postgres(value, { prepare: false, max: 3, idle_timeout: 20, connect_timeout: 10, onnotice: () => {} });
    }
    return client;
  };
  return {
    query: async (text, params = []) => (await connect().unsafe(text, params as never[])) as never,
    exec: async (text) => {
      await connect().unsafe(text);
    },
    end: async () => {
      await client?.end();
      client = null;
    },
  };
}

let cached: Store | null = null;

let sql: ReturnType<typeof postgresSql> | null = null;

/** The production connection. */
export function getSql(): Sql {
  sql ??= postgresSql(() => process.env.DATABASE_URL);
  return sql;
}

/** The production store. */
export function getStore(): Store {
  cached ??= new PgStore(getSql());
  return cached;
}
