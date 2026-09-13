import { env } from '@nexa/config';
import { getDb } from '@nexa/database';
import cookieParser from 'cookie-parser';
import { sql } from 'drizzle-orm';
import express, { type Express } from 'express';
import { loadSession, loadTenant } from './middleware/auth.js';
import { errorHandler, notFoundHandler, requestId } from './middleware/errors.js';
import { logger } from './lib/logger.js';
import { rateLimit } from './middleware/rateLimit.js';
import { serveWebClient } from './middleware/static.js';
import { apiRouter } from './routes/index.js';
import { webhookRouter } from './routes/webhooks.routes.js';

/**
 * Builds the Express application.
 *
 * Exported separately from the server bootstrap so tests can mount the real app
 * without binding a port — the tests exercise the same middleware chain,
 * including auth and tenancy, that production requests go through.
 */
export function createApp(): Express {
  const app = express();

  // Behind a load balancer / reverse proxy the client IP comes from
  // X-Forwarded-For; without this, rate limiting would key on the proxy.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestId);

  // Before express.json(): webhook signatures are computed over the raw bytes,
  // and a parsed-then-reserialised body will never reproduce them.
  app.use('/webhooks', webhookRouter);

  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    // Strict allowlist — credentials are cookies, so a wildcard origin would be
    // both invalid and unsafe.
    if (origin && origin === env.WEB_ORIGIN) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-nexa-business, x-request-id');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    next();
  });

  /**
   * Liveness: is this process alive?
   *
   * Deliberately does not touch the database. This is what Render restarts on,
   * and a readiness signal in that position is actively harmful: a five-second
   * database blip would kill a perfectly healthy process and restart it into a
   * crash loop, turning a brief degradation into an outage.
   */
  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'nexa-api', env: env.NODE_ENV, time: new Date().toISOString() });
  });

  /**
   * Readiness: can this process actually serve a request?
   *
   * Liveness alone is the reason a broken deployment can sit green for weeks.
   * The process stays up while its database is unreachable, `/health` keeps
   * answering `ok`, every real request 500s, and nothing anywhere says so.
   *
   * Point external uptime monitoring at *this* endpoint, not `/health`.
   */
  app.get('/health/ready', async (_req, res) => {
    const startedAt = Date.now();
    try {
      const db = await getDb();
      // Cheapest possible round trip. Bounded, because the failure being caught
      // is often a hang rather than a refusal — an unbounded probe would hang
      // with it and report nothing at all.
      await Promise.race([
        db.execute(sql`select 1`),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('database did not respond within 5s')), 5_000),
        ),
      ]);
      res.json({
        ok: true,
        service: 'nexa-api',
        database: 'reachable',
        latencyMs: Date.now() - startedAt,
        time: new Date().toISOString(),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unknown error';
      logger.error('readiness check failed', { detail });
      // 503 so a monitor, a load balancer and a human all read it the same way.
      // The message is the failure mode, never the connection string.
      res.status(503).json({
        ok: false,
        service: 'nexa-api',
        database: 'unreachable',
        detail,
        time: new Date().toISOString(),
      });
    }
  });

  app.use(rateLimit('global', { windowMs: 60 * 1000, max: 600 }));
  app.use(loadSession, loadTenant);
  app.use('/api', apiRouter);

  // After the API, before the 404: an unmatched /api path must still produce a
  // JSON error, not the SPA shell.
  const servingClient = serveWebClient(app);

  app.use(notFoundHandler);
  app.use(errorHandler);

  Object.assign(app.locals, { servingClient });
  return app;
}
