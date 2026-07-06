import { createMiddleware } from 'hono/factory';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

/**
 * Simple in-memory rate limiter.
 * For production, replace with Redis-backed implementation.
 */
export function rateLimit(opts: { windowMs: number; max: number; keyPrefix?: string }) {
  return createMiddleware(async (c, next) => {
    const ip = c.req.header('x-forwarded-for') ?? 'unknown';
    const key = `${opts.keyPrefix ?? 'rl'}:${ip}`;
    const now = Date.now();

    let entry = store.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + opts.windowMs };
      store.set(key, entry);
    }

    entry.count++;
    if (entry.count > opts.max) {
      return c.json(
        { data: null, error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
        429,
      );
    }

    await next();
  });
}
