import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Scheduler, withJobLock, type Job } from '../apps/api/src/worker/scheduler.js';
import { startTestServer, useTestServer } from './helpers.js';

/**
 * Background job concurrency.
 *
 * The proactive agents run inside the API process rather than a separate queue.
 * That is only safe if a job cannot run twice at once — two copies of the daily
 * brief is a bug the customer sees. Two distinct guards make that true, and
 * they cover different failure modes:
 *
 *   - the advisory lock stops a *second process* from running the job;
 *   - the scheduler's in-memory set stops a *slow run* from being joined by its
 *     own next tick.
 *
 * The second guard exists because advisory locks are session-scoped and
 * re-entrant: the same connection can take the same lock twice and succeed
 * both times, so the database alone would allow the overlap.
 */
describe('scheduled job concurrency', () => {
  useTestServer();

  it('runs the job when the lock is free', async () => {
    await startTestServer();
    const result = await withJobLock(0x7e57_0001, async () => 'ran');
    assert.equal(result, 'ran');
  });

  it('does not start a job that is already running in this process', async () => {
    await startTestServer();
    let starts = 0;
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });

    const job: Job = {
      name: 'slow-job',
      everyMs: 60_000,
      lockKey: 0x7e57_0010,
      async run() {
        starts += 1;
        await blocked;
        return 'done';
      },
    };
    const scheduler = new Scheduler([job]);

    const first = scheduler.runNow('slow-job');
    // Second tick arrives while the first is still in flight.
    await scheduler.runNow('slow-job');
    release();
    await first;

    assert.equal(starts, 1, 'the overlapping tick must be skipped, not queued');
  });

  it('releases the lock so the next scheduled run can take it', async () => {
    await startTestServer();
    const key = 0x7e57_0003;
    await withJobLock(key, async () => 'first');
    const second = await withJobLock(key, async () => 'second');
    assert.equal(second, 'second', 'the lock must not leak past the job that took it');
  });

  it('releases the lock even when the job throws', async () => {
    await startTestServer();
    const key = 0x7e57_0004;

    await assert.rejects(
      withJobLock(key, async () => {
        throw new Error('job blew up');
      }),
      /job blew up/,
    );

    // A crashed job that kept its lock would silently stop that job forever.
    const after = await withJobLock(key, async () => 'recovered');
    assert.equal(after, 'recovered');
  });

  it('does not block unrelated jobs', async () => {
    await startTestServer();
    let other: string | null = null;
    await withJobLock(0x7e57_0005, async () => {
      other = await withJobLock(0x7e57_0006, async () => 'independent');
      return 'held';
    });
    assert.equal(other, 'independent');
  });
});
