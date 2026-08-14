import { env } from '@nexa/config';
import { closeDb, runMigrations } from '@nexa/database';
import { createApp } from './app.js';
import { logger } from './lib/logger.js';
import { ALL_JOBS } from './worker/jobs.js';
import { Scheduler } from './worker/scheduler.js';

/**
 * Server bootstrap.
 *
 * Migrations run before the port opens: the process either has a schema it can
 * serve or it exits. A half-migrated instance never accepts traffic.
 */
/**
 * Configuration that is legal but probably not what the operator intended.
 *
 * These are warnings rather than boot failures because each one is a defensible
 * choice for someone who knows what they are doing — and a silent disaster for
 * someone who does not. Saying so once at startup is the difference.
 */
function warnAboutRiskyProductionConfig(): void {
  if (env.NODE_ENV !== 'production') return;

  if (env.DATABASE_DRIVER === 'pglite') {
    logger.warn(
      'running in production on PGlite — the database is a directory inside this container. ' +
        'On an ephemeral filesystem every deploy destroys it, and nothing external can take a backup. ' +
        'Set DATABASE_DRIVER=postgres with a managed database before onboarding a real business.',
    );
  }
  if (env.SEED_DEMO_DATA) {
    logger.warn('SEED_DEMO_DATA is on in production — a live install should not ship the AURA BEAUTY demo workspace.');
  }
  if (env.AI_PROVIDER === 'anthropic' && env.AI_MONTHLY_BUDGET_CENTS === 0) {
    logger.warn(
      'live AI provider with no monthly budget — set AI_MONTHLY_BUDGET_CENTS to cap what one workspace can spend.',
    );
  }
}

async function main(): Promise<void> {
  warnAboutRiskyProductionConfig();

  await runMigrations();
  logger.info('database ready', { driver: env.DATABASE_DRIVER });

  const app = createApp();
  const server = app.listen(env.API_PORT, () => {
    logger.info('NEXA API listening', {
      port: env.API_PORT,
      env: env.NODE_ENV,
      aiProvider: env.AI_PROVIDER,
      webOrigin: env.WEB_ORIGIN,
      // Tells the operator at a glance whether this instance is the whole
      // product or just its API half.
      servingWebClient: app.locals.servingClient === true,
    });
  });

  // Proactive agents. Every job is guarded by an advisory lock, so leaving this
  // on across several instances still runs each job exactly once.
  const scheduler = env.WORKER_ENABLED ? new Scheduler(ALL_JOBS) : null;
  scheduler?.start();

  const shutdown = (signal: string) => {
    logger.info('shutting down', { signal });
    scheduler?.stop();
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
