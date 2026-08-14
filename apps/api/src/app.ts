import { env } from '@nexa/config';
import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import { loadSession, loadTenant } from './middleware/auth.js';
import { errorHandler, notFoundHandler, requestId } from './middleware/errors.js';
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

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'nexa-api', env: env.NODE_ENV, time: new Date().toISOString() });
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
