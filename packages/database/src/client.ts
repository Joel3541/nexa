import { mkdirSync } from 'node:fs';
import { databaseDir, env } from '@nexa/config';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import * as schema from './schema.js';

/**
 * Driver abstraction.
 *
 * NEXA targets PostgreSQL, full stop — the schema, SQL and migrations are
 * Postgres-native. What varies is *how* we reach a Postgres engine:
 *
 *   - `pglite`   real PostgreSQL compiled to WASM, running inside this process
 *                and persisting to DATABASE_DIR. Zero infrastructure, so a
 *                developer (or CI) can clone and run with no database server.
 *   - `postgres` a normal PostgreSQL server over the wire (production).
 *
 * Both expose the identical Drizzle query surface, so application code never
 * branches on the driver and moving to a managed Postgres is a config change.
 */
export type Database = PgliteDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Accepts either the root connection or an open transaction. */
export type Executor = Database | Transaction;

let instance: Database | null = null;
let closeFn: (() => Promise<void>) | null = null;

async function createPglite(dir: string): Promise<{ db: Database; close: () => Promise<void> }> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  await client.waitReady;
  return {
    db: drizzle(client, { schema }) as Database,
    close: () => client.close(),
  };
}

async function createPostgres(url: string): Promise<{ db: Database; close: () => Promise<void> }> {
  const { default: postgres } = await import('postgres');
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const client = postgres(url, {
    max: env.NODE_ENV === 'production' ? 20 : 5,
    idle_timeout: 30,
    connect_timeout: 15,
    onnotice: () => {},
  });
  return {
    // Both drivers implement the same Drizzle API surface; the concrete generic
    // differs only in the underlying session type, which call sites never touch.
    db: drizzle(client, { schema }) as unknown as Database,
    close: () => client.end({ timeout: 5 }),
  };
}

export async function getDb(): Promise<Database> {
  if (instance) return instance;
  const created =
    env.DATABASE_DRIVER === 'postgres'
      ? await createPostgres(env.DATABASE_URL!)
      : await createPglite(databaseDir());
  instance = created.db;
  closeFn = created.close;
  return instance;
}

export async function closeDb(): Promise<void> {
  if (closeFn) {
    await closeFn();
    closeFn = null;
    instance = null;
  }
}

/** Used by tests to point at a throwaway database directory. */
export function resetDbForTesting(): void {
  instance = null;
  closeFn = null;
}

export { schema };
