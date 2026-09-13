import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { startTestServer, useTestServer } from './helpers.js';

/**
 * Liveness and readiness.
 *
 * These exist because of a real incident: the deployed instance sat returning
 * `{"ok":true}` from `/health` while its database had expired underneath it,
 * and nothing anywhere reported a problem for weeks. Liveness alone cannot
 * catch that — the process is genuinely alive, it just cannot do anything.
 *
 * The split matters in both directions, so both are pinned here: readiness
 * must actually reach the database, and liveness must *not*, because liveness
 * is what the platform restarts on and a database blip must not kill a healthy
 * process.
 */
describe('health endpoints', () => {
  useTestServer();

  it('reports liveness without touching the database', async () => {
    const base = await startTestServer();
    const response = await fetch(`${base}/health`);
    const body = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.service, 'nexa-api');
    // No database field: this endpoint deliberately makes no claim about one.
    assert.equal(body.database, undefined);
  });

  it('confirms the database is reachable on the readiness endpoint', async () => {
    const base = await startTestServer();
    const response = await fetch(`${base}/health/ready`);
    const body = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.database, 'reachable');
    assert.equal(typeof body.latencyMs, 'number');
  });

  it('is reachable without authentication, so a monitor can poll it', async () => {
    const base = await startTestServer();
    // No cookie, no business header — an uptime monitor has neither.
    for (const path of ['/health', '/health/ready']) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 200, `${path} must not require auth`);
    }
  });

  it('never leaks connection details in the readiness payload', async () => {
    const base = await startTestServer();
    const raw = await (await fetch(`${base}/health/ready`)).text();
    // A readiness endpoint is public by necessity; it must not become a source
    // of credentials or topology for anyone who curls it.
    for (const secret of ['password', 'postgres://', 'postgresql://', 'AUTH_SECRET']) {
      assert.ok(!raw.toLowerCase().includes(secret.toLowerCase()), `readiness leaked "${secret}"`);
    }
  });
});
