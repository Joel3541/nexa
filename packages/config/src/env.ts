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
    AI_MODEL: z.string().default('claude-sonnet-5'),
    AI_MAX_TOKENS: z.coerce.number().int().min(256).max(32000).default(2048),

    EMAIL_PROVIDER: z.enum(['console', 'smtp']).default('console'),
    EMAIL_FROM: z.string().default('nexa@example.com'),
    EMAIL_PROVIDER_KEY: z.string().optional(),
    SMS_PROVIDER: z.enum(['console', 'twilio']).default('console'),
    SMS_PROVIDER_KEY: z.string().optional(),
    WHATSAPP_PROVIDER: z.enum(['console', 'meta']).default('console'),
    WHATSAPP_PROVIDER_KEY: z.string().optional(),

    PAYMENT_PROVIDER: z.enum(['mock', 'stripe', 'paystack', 'flutterwave']).default('mock'),
    PAYMENT_PROVIDER_KEY: z.string().optional(),
    PAYMENT_WEBHOOK_SECRET: z.string().optional(),

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
