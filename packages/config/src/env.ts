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

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    WEB_ORIGIN: z.string().default('http://localhost:5173'),

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

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
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
