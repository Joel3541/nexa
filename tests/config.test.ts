import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectPlatformOrigin, resolveDatabaseDriver } from '@nexa/config';

/**
 * Platform detection.
 *
 * Both helpers below exist because of the same class of failure: a setting that
 * is wrong in production only, on a host nobody can reproduce locally, and that
 * breaks something nobody checks on the first day. They are pure functions over
 * an environment record precisely so this can be tested without a deploy.
 */
describe('platform origin detection', () => {
  it('uses the full origin Render injects', () => {
    assert.equal(
      detectPlatformOrigin({ RENDER_EXTERNAL_URL: 'https://nexa-x8k2.onrender.com' }),
      'https://nexa-x8k2.onrender.com',
    );
  });

  it("adds the scheme Railway's bare hostname is missing", () => {
    // RAILWAY_PUBLIC_DOMAIN is documented as `example.up.railway.app` — no
    // scheme. Passed through unchanged it would produce relative links in every
    // verification and password-reset email, which fail silently in mail
    // clients while the server log stays clean.
    assert.equal(
      detectPlatformOrigin({ RAILWAY_PUBLIC_DOMAIN: 'nexa-production.up.railway.app' }),
      'https://nexa-production.up.railway.app',
    );
  });

  it("derives Fly's default origin from the app name", () => {
    assert.equal(detectPlatformOrigin({ FLY_APP_NAME: 'nexa' }), 'https://nexa.fly.dev');
  });

  it('returns undefined off-platform, so the local default applies', () => {
    assert.equal(detectPlatformOrigin({}), undefined);
    // A variable present but blank is how a cleared dashboard field arrives.
    assert.equal(detectPlatformOrigin({ RAILWAY_PUBLIC_DOMAIN: '  ' }), undefined);
  });

  it('never strips a scheme that is already there', () => {
    // Belt and braces: if a platform ever changes its variable to include the
    // scheme, detection must not end up with `https://https://…`.
    assert.equal(
      detectPlatformOrigin({ RAILWAY_PUBLIC_DOMAIN: 'https://nexa.up.railway.app' }),
      'https://nexa.up.railway.app',
    );
  });
});

describe('database driver inference', () => {
  it('chooses postgres in production when a DATABASE_URL is present', () => {
    // The failure this prevents: defaulting to PGlite means the app boots
    // against a directory inside the container, serves every request correctly,
    // and loses all of it on the next deploy. Nothing errors.
    assert.equal(
      resolveDatabaseDriver({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://nexa:secret@containers-us-west-1.railway.app:6543/railway',
      }),
      'postgres',
    );
  });

  it('never overrides an explicit driver, including an explicit pglite', () => {
    // Deliberate PGlite on a persistent volume is a defensible single-tenant
    // setup. It is warned about at startup; it is not overruled here.
    assert.equal(
      resolveDatabaseDriver({
        NODE_ENV: 'production',
        DATABASE_DRIVER: 'pglite',
        DATABASE_URL: 'postgresql://localhost:5432/nexa',
      }),
      undefined,
    );
  });

  it('leaves development alone even with a DATABASE_URL set', () => {
    // .env.example ships a DATABASE_URL line for convenience. Inferring from it
    // would silently drag every developer onto a server they have not started.
    assert.equal(
      resolveDatabaseDriver({ NODE_ENV: 'development', DATABASE_URL: 'postgresql://localhost:5432/nexa' }),
      undefined,
    );
  });

  it('infers nothing in production without a DATABASE_URL', () => {
    assert.equal(resolveDatabaseDriver({ NODE_ENV: 'production' }), undefined);
    assert.equal(resolveDatabaseDriver({ NODE_ENV: 'production', DATABASE_URL: '' }), undefined);
  });
});
