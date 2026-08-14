import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { databaseDir, env } from '@nexa/config';
import { getDb } from './client.js';

const MIGRATIONS_FOLDER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/**
 * Applies the versioned SQL migrations in packages/database/migrations.
 * Idempotent: Drizzle records applied migrations in `drizzle.__drizzle_migrations`.
 */
export async function runMigrations(): Promise<void> {
  const db = await getDb();
  if (env.DATABASE_DRIVER === 'postgres') {
    const { migrate } = await import('drizzle-orm/postgres-js/migrator');
    await migrate(db as never, { migrationsFolder: MIGRATIONS_FOLDER });
  } else {
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    await migrate(db as never, { migrationsFolder: MIGRATIONS_FOLDER });
  }
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectRun) {
  const target = env.DATABASE_DRIVER === 'postgres' ? env.DATABASE_URL : databaseDir();
  console.log(`[nexa:db] applying migrations (${env.DATABASE_DRIVER}) → ${target}`);
  runMigrations()
    .then(async () => {
      console.log('[nexa:db] migrations applied');
      const { closeDb } = await import('./client.js');
      await closeDb();
      process.exit(0);
    })
    .catch((error: unknown) => {
      console.error('[nexa:db] migration failed:', error);
      process.exit(1);
    });
}
