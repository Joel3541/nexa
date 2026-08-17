/**
 * `npm run preflight` — is this instance fit for real users?
 *
 * The gap between "deployed" and "ready for the public" is a list of stubs that
 * each look fine in a config file and fail only when a real person hits them.
 * Console email looks harmless until someone forgets their password; a free
 * database looks harmless until day 90. This turns that list into a command.
 *
 * Three levels, and the distinction is deliberate:
 *
 *  - **BLOCK** — a real user will hit this and lose data, money, or access.
 *  - **WARN**  — degraded or risky, but nobody is locked out.
 *  - **OK**    — verified fit for purpose.
 *
 * Exits non-zero if anything is BLOCK, so it can gate a release in CI.
 *
 * It reads configuration only. Nothing here contacts a provider, so it can say
 * a key is *present* but never that it *works* — `npm run ai:verify` is the
 * command that proves the AI path end to end.
 */

import { env, isProduction } from '@nexa/config';
import { formatMicros } from '@nexa/ai';

type Level = 'ok' | 'warn' | 'block';

interface Check {
  level: Level;
  area: string;
  finding: string;
  fix?: string;
}

const checks: Check[] = [];
const ok = (area: string, finding: string) => checks.push({ level: 'ok', area, finding });
const warn = (area: string, finding: string, fix?: string) =>
  checks.push({ level: 'warn', area, finding, ...(fix ? { fix } : {}) });
const block = (area: string, finding: string, fix: string) =>
  checks.push({ level: 'block', area, finding, fix });

/* -------------------------------------------------------------------------- */
/* Identity and transport                                                      */
/* -------------------------------------------------------------------------- */

if (env.AUTH_SECRET.startsWith('nexa-development-secret')) {
  block('auth', 'AUTH_SECRET is still the development default.', 'Set a 32+ char random value: openssl rand -hex 32');
} else if (env.AUTH_SECRET.length < 32) {
  block('auth', `AUTH_SECRET is only ${env.AUTH_SECRET.length} characters.`, 'Use at least 32 random characters.');
} else {
  ok('auth', `AUTH_SECRET set (${env.AUTH_SECRET.length} chars).`);
}

if (isProduction && !env.COOKIE_SECURE) {
  block('auth', 'COOKIE_SECURE is off in production.', 'Set COOKIE_SECURE=true so session cookies require HTTPS.');
} else {
  ok('auth', `COOKIE_SECURE=${env.COOKIE_SECURE}.`);
}

if (!/^https?:\/\//.test(env.WEB_ORIGIN)) {
  block('links', `WEB_ORIGIN has no scheme: "${env.WEB_ORIGIN}".`, 'Include https:// — email links break silently without it.');
} else if (isProduction && env.WEB_ORIGIN.includes('localhost')) {
  block(
    'links',
    `WEB_ORIGIN points at localhost in production: ${env.WEB_ORIGIN}`,
    'Every verification and password-reset link would point at the user\'s own machine.',
  );
} else {
  ok('links', `WEB_ORIGIN=${env.WEB_ORIGIN}`);
}

/* -------------------------------------------------------------------------- */
/* Durability                                                                  */
/* -------------------------------------------------------------------------- */

if (isProduction && env.DATABASE_DRIVER === 'pglite') {
  block(
    'database',
    'Running on PGlite in production — the database is a directory inside the container.',
    'Set DATABASE_DRIVER=postgres with a managed database. On an ephemeral filesystem every deploy destroys it, and nothing external can back it up.',
  );
} else {
  ok('database', `driver=${env.DATABASE_DRIVER}`);
}

if (isProduction && env.SEED_DEMO_DATA) {
  block(
    'database',
    'SEED_DEMO_DATA is on in production.',
    'The demo credentials are published in the repository, so this is a public login to your workspace.',
  );
} else {
  ok('database', 'demo seed disabled.');
}

/* -------------------------------------------------------------------------- */
/* Email — the one that locks users out                                        */
/* -------------------------------------------------------------------------- */

if (env.EMAIL_PROVIDER === 'console') {
  block(
    'email',
    'Email is set to `console`, so nothing is delivered — password reset has no recovery path.',
    'Set SMTP_HOST/SMTP_USER/SMTP_PASSWORD/EMAIL_FROM, then EMAIL_PROVIDER=smtp.',
  );
} else if (!env.SMTP_HOST) {
  block('email', 'EMAIL_PROVIDER=smtp but SMTP_HOST is empty.', 'Set the SMTP host from your provider.');
} else {
  ok('email', `smtp via ${env.SMTP_HOST}:${env.SMTP_PORT} (secure=${env.SMTP_SECURE})`);
  if (!env.EMAIL_FROM || env.EMAIL_FROM.endsWith('@example.com')) {
    warn(
      'email',
      `EMAIL_FROM is "${env.EMAIL_FROM}", which is not a real sending address.`,
      'Use an address on a domain verified with your provider, or mail is dropped or spam-filed.',
    );
  }
  if (!env.SMTP_USER) warn('email', 'No SMTP_USER — only correct for an unauthenticated relay.');
}

/* -------------------------------------------------------------------------- */
/* AI                                                                          */
/* -------------------------------------------------------------------------- */

if (env.AI_PROVIDER === 'mock') {
  warn(
    'ai',
    'AI is the mock provider — answers come from real data but are not model-composed.',
    'Set AI_API_KEY, then AI_PROVIDER=anthropic, then run: npm run ai:verify',
  );
} else {
  ok('ai', `provider=anthropic model=${env.AI_MODEL} effort=${env.AI_EFFORT} thinking=${env.AI_THINKING}`);
  if (env.AI_MONTHLY_BUDGET_CENTS === 0) {
    block(
      'ai',
      'Live AI provider with no spend ceiling (AI_MONTHLY_BUDGET_CENTS=0).',
      'Set a per-business monthly cap. A public URL with an uncapped budget is your bill.',
    );
  } else {
    ok('ai', `budget ${formatMicros(env.AI_MONTHLY_BUDGET_CENTS * 10_000)} per business per month.`);
  }
}

/* -------------------------------------------------------------------------- */
/* Payments                                                                    */
/* -------------------------------------------------------------------------- */

if (env.PAYMENT_PROVIDER === 'mock') {
  warn('payments', 'Payments are simulated — no money can move.', 'Set PAYMENT_PROVIDER=paystack (or stripe) with its key and webhook secret.');
} else if (!env.PAYMENT_WEBHOOK_SECRET) {
  // Unreachable via config validation, which already refuses to boot. Kept as a
  // second line of defence: if that check is ever relaxed, this is the property
  // that must not be lost.
  block(
    'payments',
    `PAYMENT_PROVIDER=${env.PAYMENT_PROVIDER} without a webhook secret.`,
    'Anyone who finds the webhook URL could mark invoices paid.',
  );
} else {
  ok('payments', `provider=${env.PAYMENT_PROVIDER}, webhook signing configured.`);
  if (!env.PAYMENT_CALLBACK_URL) {
    warn('payments', 'No PAYMENT_CALLBACK_URL — payers are not returned anywhere after checkout.');
  }
}

/* -------------------------------------------------------------------------- */
/* Operations                                                                  */
/* -------------------------------------------------------------------------- */

if (!env.RATE_LIMIT_ENABLED) {
  warn('ops', 'Rate limiting is disabled.', 'Only correct behind a gateway that enforces limits itself.');
} else {
  ok('ops', 'rate limiting on.');
}

if (!env.WORKER_ENABLED) {
  warn('ops', 'Worker disabled — no agent scans and no Morning Brief.');
} else {
  ok('ops', 'proactive agents enabled.');
}

/* -------------------------------------------------------------------------- */
/* Report                                                                      */
/* -------------------------------------------------------------------------- */

const TAG: Record<Level, string> = {
  ok: '  [32mOK[0m   ',
  warn: '  [33mWARN[0m ',
  block: '  [31mBLOCK[0m',
};

console.log(`\n[1mNEXA preflight[0m — NODE_ENV=${env.NODE_ENV}\n`);

for (const level of ['block', 'warn', 'ok'] as const) {
  for (const check of checks.filter((c) => c.level === level)) {
    console.log(`${TAG[level]} [${check.area}] ${check.finding}`);
    if (check.fix) console.log(`         → ${check.fix}`);
  }
}

const blockers = checks.filter((c) => c.level === 'block').length;
const warnings = checks.filter((c) => c.level === 'warn').length;

console.log('');
if (blockers > 0) {
  console.log(
    `[31m[1m${blockers} blocker(s)[0m and ${warnings} warning(s). ` +
      `Not ready for real users.\n`,
  );
  process.exit(1);
}
if (warnings > 0) {
  console.log(`[33m[1mNo blockers, ${warnings} warning(s).[0m Usable, with the gaps above.\n`);
  process.exit(0);
}
console.log('[32m[1mAll checks passed.[0m\n');
process.exit(0);
