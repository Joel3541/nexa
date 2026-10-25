import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

/**
 * Locate the repository root by walking up from this file until we find the
 * workspace package.json. Every process (api, seed scripts, tests) then reads
 * the same `.env`, regardless of the directory it was launched from.
 */
function findRepoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(path.join(dir, 'package.json')) && existsSync(path.join(dir, 'packages'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export const REPO_ROOT = findRepoRoot();

dotenv.config({ path: path.join(REPO_ROOT, '.env'), quiet: true });

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) => (typeof value === 'boolean' ? value : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())));

/** Prefix a bare hostname with https://. A full URL is returned unchanged. */
function withScheme(host: string | undefined): string | undefined {
  const value = host?.trim();
  if (!value) return undefined;
  return /^https?:\/\//.test(value) ? value : `https://${value}`;
}

/**
 * Hosting platforms that publish the deployment's own public address.
 *
 * This exists because a service cannot know its own URL on a first deploy — the
 * URL does not exist until the service does — so `WEB_ORIGIN` is the one
 * setting that cannot be filled in ahead of time. Reading whichever variable
 * the platform injects closes that gap without tying the app to any one host.
 *
 * The scheme is the whole point. These values end up inside verification and
 * password-reset links, and `example.com/verify-email?token=…` without a scheme
 * is treated by mail clients as a relative path: the link fails for every
 * signup and nothing in the server log looks wrong.
 */
const PLATFORM_ORIGINS: ReadonlyArray<{
  platform: string;
  read: (source: NodeJS.ProcessEnv) => string | undefined;
}> = [
  // Render injects the full origin, scheme included.
  { platform: 'Render', read: (source) => withScheme(source.RENDER_EXTERNAL_URL) },
  // Railway publishes a bare hostname — `nexa-production.up.railway.app`.
  { platform: 'Railway', read: (source) => withScheme(source.RAILWAY_PUBLIC_DOMAIN) },
  // Fly names the app; its default origin follows from the name.
  { platform: 'Fly.io', read: (source) => (source.FLY_APP_NAME?.trim() ? `https://${source.FLY_APP_NAME.trim()}.fly.dev` : undefined) },
];

/**
 * The public origin of this deployment according to the platform running it,
 * or undefined when nothing recognisable is present (local, Docker, bare VM).
 */
export function detectPlatformOrigin(source: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const { read } of PLATFORM_ORIGINS) {
    const origin = read(source);
    if (origin) return origin;
  }
  return undefined;
}

/**
 * The database driver to use when the operator has not named one.
 *
 * `pglite` is the right default for development and CI: a real PostgreSQL
 * engine in-process, no server to install. In production it is a trap. A
 * `DATABASE_URL` is a managed database somebody deliberately provisioned, and
 * every platform that provisions one injects it under exactly that name — so
 * falling back to pglite there means the app boots happily against a directory
 * inside the container, serves every request correctly, and loses all of it on
 * the next deploy. Nothing fails; the data is simply gone.
 *
 * An explicit `DATABASE_DRIVER` always wins, including an explicit `pglite` in
 * production, which is a defensible choice on a persistent volume and still
 * warned about at startup.
 *
 * Returns the driver to apply, or undefined to leave the setting alone.
 */
export function resolveDatabaseDriver(source: NodeJS.ProcessEnv): 'postgres' | undefined {
  if (source.DATABASE_DRIVER?.trim()) return undefined;
  if (source.NODE_ENV !== 'production') return undefined;
  return source.DATABASE_URL?.trim() ? 'postgres' : undefined;
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    /**
     * Port to bind.
     *
     * `PORT` wins when present. Every container platform NEXA is likely to run
     * on — Render, Railway, Fly, Heroku, Cloud Run — assigns a port and injects
     * it under that name, then health-checks the port it assigned. A service
     * that ignores it binds somewhere nobody is listening, the health check
     * times out, and the platform reports a crash loop with no error in the
     * application log. `API_PORT` remains the knob for local development.
     */
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    /**
     * Public origin of this deployment, **including the scheme**.
     *
     * Used for the CORS allowlist and, more importantly, interpolated into the
     * verification and password-reset links that go out by email. A value
     * without a scheme produces `example.com/verify-email?token=…`, which mail
     * clients treat as a relative path — the link silently fails for every new
     * signup, and nothing in the server logs looks wrong.
     *
     * Falls back to whatever the hosting platform publishes about itself — see
     * `PLATFORM_ORIGINS`. That is the only way to get this right on a first
     * deploy, because the service's own URL does not exist until the service
     * does. Any host that is not recognised simply sets WEB_ORIGIN directly.
     *
     * An *explicit* value is still held to the scheme requirement rather than
     * being repaired, because a bare hostname typed into a hosting dashboard is
     * ambiguous — http or https, apex or subdomain — and a refusal to boot with
     * a readable message beats a guess that breaks email a week later.
     */
    WEB_ORIGIN: z
      .string()
      .optional()
      // An empty string is not the same as unset to Zod's `.default()`, but it
      // is to a human who left the field blank in a hosting dashboard. Treat
      // blank as absent, or that person gets a validation error they cannot
      // interpret.
      .transform((value) => {
        const explicit = value?.trim();
        if (explicit) return explicit;
        return detectPlatformOrigin() ?? 'http://localhost:5173';
      })
      .refine((value) => /^https?:\/\//.test(value), {
        message: 'WEB_ORIGIN must include a scheme, e.g. https://nexa.up.railway.app',
      }),

    DATABASE_DRIVER: z.enum(['pglite', 'postgres']).default('pglite'),
    DATABASE_DIR: z.string().default('.pgdata'),
    DATABASE_URL: z.string().optional(),

    AUTH_SECRET: z.string().min(32).default('nexa-development-secret-change-me-please-32'),
    SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    COOKIE_SECURE: booleanish.default(false),

    AI_PROVIDER: z.enum(['mock', 'anthropic']).default('mock'),
    AI_API_KEY: z.string().optional(),
    AI_MODEL: z.string().default('claude-opus-5'),
    AI_MAX_TOKENS: z.coerce.number().int().min(256).max(32000).default(4096),
    /** Reasoning depth. `medium` balances answer quality against spend. */
    AI_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium'),
    /** Adaptive thinking. Off trades answer quality for lower latency and cost. */
    AI_THINKING: booleanish.default(true),
    AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
    AI_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(600_000).default(120_000),
    /**
     * Per-business spend ceiling for a calendar month, in whole US cents.
     * 0 disables the cap. This is a guard rail against a runaway loop or an
     * abusive tenant, not a billing system — it is enforced on estimated cost.
     */
    AI_MONTHLY_BUDGET_CENTS: z.coerce.number().int().min(0).default(0),

    EMAIL_PROVIDER: z.enum(['console', 'smtp']).default('console'),
    EMAIL_FROM: z.string().default('nexa@example.com'),
    EMAIL_PROVIDER_KEY: z.string().optional(),
    /** SMTP transport. Required when EMAIL_PROVIDER=smtp. */
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    /** Implicit TLS (port 465). Port 587 upgrades via STARTTLS instead. */
    SMTP_SECURE: booleanish.default(false),
    SMS_PROVIDER: z.enum(['console', 'twilio']).default('console'),
    SMS_PROVIDER_KEY: z.string().optional(),
    WHATSAPP_PROVIDER: z.enum(['console', 'meta']).default('console'),
    WHATSAPP_PROVIDER_KEY: z.string().optional(),

    PAYMENT_PROVIDER: z.enum(['mock', 'stripe', 'paystack']).default('mock'),
    PAYMENT_PROVIDER_KEY: z.string().optional(),
    PAYMENT_WEBHOOK_SECRET: z.string().optional(),
    /** Where the payer returns after completing a hosted checkout. */
    PAYMENT_CALLBACK_URL: z.string().optional(),

    /**
     * Runs the proactive agent scans and the daily brief in this process.
     * Safe to leave on with several instances — the jobs take a PostgreSQL
     * advisory lock, so exactly one instance executes each run.
     */
    WORKER_ENABLED: booleanish.default(true),

    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    RATE_LIMIT_ENABLED: booleanish.default(true),
    SEED_DEMO_DATA: booleanish.default(true),
  })
  .superRefine((value, ctx) => {
    if (value.DATABASE_DRIVER === 'postgres' && !value.DATABASE_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL is required when DATABASE_DRIVER=postgres',
      });
    }
    if (value.AI_PROVIDER === 'anthropic' && !value.AI_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['AI_API_KEY'],
        message: 'AI_API_KEY is required when AI_PROVIDER=anthropic',
      });
    }
    if (value.EMAIL_PROVIDER === 'smtp' && !value.SMTP_HOST) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_HOST'],
        message: 'SMTP_HOST is required when EMAIL_PROVIDER=smtp',
      });
    }
    if (value.PAYMENT_PROVIDER !== 'mock' && !value.PAYMENT_PROVIDER_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYMENT_PROVIDER_KEY'],
        message: `PAYMENT_PROVIDER_KEY is required when PAYMENT_PROVIDER=${value.PAYMENT_PROVIDER}`,
      });
    }
    // A live payment rail without webhook verification means anyone who can
    // reach the callback URL can mark invoices paid. Refuse to boot that way.
    if (value.PAYMENT_PROVIDER !== 'mock' && !value.PAYMENT_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYMENT_WEBHOOK_SECRET'],
        message:
          'PAYMENT_WEBHOOK_SECRET is required for a live payment provider — unverified webhooks would let anyone forge a payment',
      });
    }
    if (value.NODE_ENV === 'production') {
      if (value.AUTH_SECRET.startsWith('nexa-development-secret')) {
        ctx.addIssue({
          code: 'custom',
          path: ['AUTH_SECRET'],
          message: 'AUTH_SECRET must be changed from the development default in production',
        });
      }
      if (!value.COOKIE_SECURE) {
        ctx.addIssue({
          code: 'custom',
          path: ['COOKIE_SECURE'],
          message: 'COOKIE_SECURE must be true in production',
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

/** True when the driver was inferred rather than configured. Logged at boot. */
export let databaseDriverWasInferred = false;

function loadEnv(): Env {
  // Everything the platform decides for us, resolved in one place so the
  // precedence is readable rather than spread across the schema.
  const overrides: Record<string, string> = {};

  // A platform-assigned PORT outranks the configured API_PORT. Render, Railway,
  // Fly, Heroku and Cloud Run all assign a port, inject it under this name, and
  // health-check the port they assigned; a service that ignores it binds where
  // nobody is listening and surfaces as a crash loop with a clean app log.
  if (process.env.PORT) overrides.API_PORT = process.env.PORT;

  const inferredDriver = resolveDatabaseDriver(process.env);
  if (inferredDriver) {
    overrides.DATABASE_DRIVER = inferredDriver;
    databaseDriverWasInferred = true;
  }

  const source: NodeJS.ProcessEnv =
    Object.keys(overrides).length > 0 ? { ...process.env, ...overrides } : process.env;

  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration. NEXA refuses to start with a bad config.\n${details}\n\n` +
        `Copy .env.example to .env and adjust the values.`,
    );
  }
  return parsed.data;
}

export const env: Env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/** Absolute path of the on-disk directory used by the PGlite driver. */
export function databaseDir(): string {
  return path.isAbsolute(env.DATABASE_DIR) ? env.DATABASE_DIR : path.join(REPO_ROOT, env.DATABASE_DIR);
}
