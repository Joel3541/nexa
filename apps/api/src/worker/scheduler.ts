import { getDb } from '@nexa/database';
import { sql } from 'drizzle-orm';
import { logger } from '../lib/logger.js';

/**
 * In-process job scheduler.
 *
 * NEXA does not ship a queue. For the work it actually has — a handful of
 * periodic scans over each business's own data — a queue would be infrastructure
 * a small business has to operate for no benefit. What that decision *does*
 * require is an answer to "what happens with two instances running?", because
 * two copies of the daily brief is a bug the customer sees.
 *
 * The answer is two guards, because one is not enough:
 *
 *  - **Across processes**, a PostgreSQL advisory lock. It costs nothing, needs
 *    no extra service, and is released automatically if the process holding it
 *    dies — precisely the failure a naive "flag row" design handles badly.
 *  - **Within a process**, an in-memory set of running jobs. Advisory locks are
 *    *session*-scoped and re-entrant: the same connection can take the same
 *    lock twice and succeed both times. So if a job ever outruns its own
 *    interval, the database would happily let the second tick start on top of
 *    the first. The set is what actually prevents that.
 *
 * Between them, a given job runs at most once at a time anywhere in the fleet.
 */

export interface Job {
  name: string;
  /** How often to attempt the job. */
  everyMs: number;
  /** Stable 32-bit key for the advisory lock. Must be unique per job. */
  lockKey: number;
  run(now: Date): Promise<string>;
}

/**
 * Runs `fn` only if this process can take the named lock.
 *
 * `pg_try_advisory_lock` returns immediately rather than queuing, so a second
 * instance does not pile up waiting for a job it should simply skip.
 */
export async function withJobLock<T>(lockKey: number, fn: () => Promise<T>): Promise<T | null> {
  const db = await getDb();
  const result = await db.execute(sql`select pg_try_advisory_lock(${lockKey}) as locked`);
  // The two drivers disagree on the shape of a raw result: PGlite returns
  // `{ rows }`, postgres-js returns the array itself. Normalise rather than
  // branch on DATABASE_DRIVER — the rest of the codebase never has to know
  // which engine it is talking to, and this should not be the exception.
  const rows = (Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])) as Array<{
    locked?: boolean;
  }>;
  if (!rows[0]?.locked) return null;

  try {
    return await fn();
  } finally {
    // Released explicitly so a long-lived pooled connection does not hold it
    // until the process exits.
    await db.execute(sql`select pg_advisory_unlock(${lockKey})`);
  }
}

export class Scheduler {
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly running = new Set<string>();
  private stopped = false;

  constructor(private readonly jobs: Job[]) {}

  start(): void {
    for (const job of this.jobs) {
      // Staggered so a restart does not fire every job in the same tick.
      const jitter = Math.floor(Math.random() * 30_000);
      const timer = setInterval(() => void this.execute(job), job.everyMs);
      // unref: a pending timer must never keep the process alive during a
      // graceful shutdown.
      timer.unref();
      this.timers.push(timer);

      const kickoff = setTimeout(() => void this.execute(job), 15_000 + jitter);
      kickoff.unref();
      this.timers.push(kickoff);
    }
    logger.info('scheduler started', { jobs: this.jobs.map((job) => job.name) });
  }

  stop(): void {
    this.stopped = true;
    for (const timer of this.timers) clearInterval(timer);
    this.timers.length = 0;
  }

  private async execute(job: Job): Promise<void> {
    if (this.stopped) return;

    // A run that outlasts its own interval must not be joined by the next tick.
    // The advisory lock alone would permit it — same session, re-entrant.
    if (this.running.has(job.name)) {
      logger.warn('job still running, skipping this tick', { job: job.name });
      return;
    }
    this.running.add(job.name);

    const startedAt = Date.now();
    try {
      const outcome = await withJobLock(job.lockKey, () => job.run(new Date()));
      if (outcome === null) return; // another instance has it
      logger.info('job finished', { job: job.name, ms: Date.now() - startedAt, outcome });
    } catch (error) {
      // A failing job must never take the API process down with it.
      logger.error('job failed', {
        job: job.name,
        ms: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.running.delete(job.name);
    }
  }

  /** Runs a job now, respecting both guards. Used by tests and by ops tooling. */
  async runNow(name: string): Promise<void> {
    const job = this.jobs.find((candidate) => candidate.name === name);
    if (!job) throw new Error(`Unknown job "${name}".`);
    await this.execute(job);
  }
}
