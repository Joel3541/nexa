import { existsSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '@nexa/config';
import express, { type Express } from 'express';

/**
 * Serves the built web client from the API process.
 *
 * Single-origin deployment is the default for a reason: it removes CORS from
 * production entirely, lets the session cookie be `SameSite=Lax` without a
 * cross-site exemption, and means hosting NEXA is one container rather than a
 * frontend host plus an API host that have to agree on an origin. A small
 * business does not want to operate two deployments.
 *
 * When the bundle is absent — the normal case in development, where Vite serves
 * the client on its own port — this mounts nothing at all. Missing assets must
 * not turn every unmatched API path into an HTML response.
 */
export function serveWebClient(app: Express): boolean {
  const dist = path.join(REPO_ROOT, 'apps', 'web', 'dist');
  if (!existsSync(path.join(dist, 'index.html'))) return false;

  // Hashed assets are immutable; index.html must never be cached or a deploy
  // leaves browsers loading an old bundle that references deleted chunks.
  app.use(
    '/assets',
    express.static(path.join(dist, 'assets'), {
      immutable: true,
      maxAge: '1y',
      fallthrough: false,
    }),
  );

  app.use(express.static(dist, { index: false, maxAge: '1h' }));

  // SPA fallback, last. Anything that is not an API route, a webhook, or a real
  // file is a client-side route — hand it index.html and let the router decide.
  app.get(/^\/(?!api\/|webhooks\/|health$).*/, (_req, res) => {
    res.sendFile(path.join(dist, 'index.html'), {
      headers: { 'Cache-Control': 'no-cache' },
    });
  });

  return true;
}
