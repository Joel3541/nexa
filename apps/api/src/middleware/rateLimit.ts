import { env } from '@nexa/config';
import type { RequestHandler } from 'express';
import { tooManyRequests } from '../lib/errors.js';
import { clientIp } from './context.js';

/**
 * Fixed-window rate limiter.
 *
 * The store is an interface, not a Map, so moving to Redis for multi-instance
 * deployments is a swap of `setRateLimitStore` — call sites do not change.
 * The in-memory default is correct for a single process and honest about its
 * limitation: it does not coordinate across instances.
 */
export interface RateLimitStore {
  hit(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>;
}

class MemoryStore implements RateLimitStore {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  async hit(key: string, windowMs: number) {
    const now = Date.now();
    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + windowMs };
      this.buckets.set(key, fresh);
      if (this.buckets.size > 10_000) this.sweep(now);
      return fresh;
    }
    existing.count += 1;
    return existing;
  }

  private sweep(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}

let store: RateLimitStore = new MemoryStore();

export function setRateLimitStore(next: RateLimitStore): void {
  store = next;
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  /** Defaults to client IP; auth routes add the submitted email. */
  key?: (req: Parameters<RequestHandler>[0]) => string;
  message?: string;
}

export function rateLimit(name: string, options: RateLimitOptions): RequestHandler {
  return (req, res, next) => {
    if (!env.RATE_LIMIT_ENABLED) return next();
    void (async () => {
      const identity = options.key ? options.key(req) : (clientIp(req) ?? 'unknown');
      const bucket = await store.hit(`${name}:${identity}`, options.windowMs);
      const remaining = Math.max(0, options.max - bucket.count);
      res.setHeader('X-RateLimit-Limit', String(options.max));
      res.setHeader('X-RateLimit-Remaining', String(remaining));
      res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
      if (bucket.count > options.max) {
        res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - Date.now()) / 1000)));
        return next(tooManyRequests(options.message));
      }
      next();
    })().catch(next);
  };
}

export function resetRateLimitsForTesting(): void {
  store = new MemoryStore();
}
