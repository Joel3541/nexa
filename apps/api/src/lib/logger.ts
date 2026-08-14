import { env } from '@nexa/config';

/**
 * Minimal structured logger.
 *
 * Emits single-line JSON in production (ready for any log aggregator) and
 * readable text in development. Deliberately dependency-free — swapping in
 * pino/OpenTelemetry later means replacing this module only.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

const threshold = LEVELS[env.LOG_LEVEL];

const REDACT_KEYS = new Set(['password', 'token', 'authorization', 'cookie', 'apiKey', 'secret', 'passwordHash']);

function redact(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = REDACT_KEYS.has(key) ? '[redacted]' : redact(val);
  }
  return out;
}

function emit(level: Level, message: string, context?: Record<string, unknown>): void {
  if (LEVELS[level] < threshold) return;
  const payload = { level, time: new Date().toISOString(), message, ...(context ? (redact(context) as object) : {}) };
  if (env.NODE_ENV === 'production') {
    console.log(JSON.stringify(payload));
    return;
  }
  const suffix = context ? ` ${JSON.stringify(redact(context))}` : '';
  const line = `[nexa:${level}] ${message}${suffix}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => emit('debug', message, context),
  info: (message: string, context?: Record<string, unknown>) => emit('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => emit('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => emit('error', message, context),
};
