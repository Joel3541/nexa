import { defineConfig } from 'drizzle-kit';

/**
 * Migrations are generated once against the Postgres dialect and then applied
 * unchanged by whichever driver is configured (PGlite locally, a Postgres
 * server in production). Generate with:  npm run generate -w @nexa/database
 *
 * Paths stay relative — drizzle-kit resolves them from this package directory
 * and its glob matcher does not accept Windows-style absolute paths.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  driver: 'pglite',
  dbCredentials: {
    url: '../../.pgdata',
  },
  strict: true,
  verbose: true,
});
