import { env } from '@nexa/config';
import { closeDb, runMigrations } from '@nexa/database';
import { createApp } from './app.js';
import { logger } from './lib/logger.js';

/**
 * Server bootstrap.
 *
 * Migrations run before the port opens: the process either has a schema it can
 * serve or it exits. A half-migrated instance never accepts traffic.
 */
async function main(): Promise<void> {
  await runMigrations();
  logger.info('database ready', { driver: env.DATABASE_DRIVER });

  const app = createApp();
  const server = app.listen(env.API_PORT, () => {
    logger.info('NEXA API listening', {
      port: env.API_PORT,
      env: env.NODE_ENV,
      aiProvider: env.AI_PROVIDER,
      webOrigin: env.WEB_ORIGIN,
    });
  });

  const shutdown = (signal: string) => {
    logger.info('shutting down', { signal });
    server.close(() => {
      void closeDb().finally(() => process.exit(0));
    });
    // Never hang forever on a stuck connection.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  logger.error('failed to start', { error: error instanceof Error ? error.message : String(error) });
  console.error(error);
  process.exit(1);
});
