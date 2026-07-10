import { createMiddleware } from 'hono/factory';
import { sql } from 'drizzle-orm';
import { db } from '../models/db';
import { rateLimitHits } from '../models/schema';
import { logger } from '../lib/logger';

/**
 * Durable, cross-instance rate limiter backed by Postgres (H2).
 *
 * Why not in-memory: on Vercel each warm instance has its own memory and instances
 * are ephemeral, so an in-memory Map resets constantly and limits are effectively
 * bypassable. A shared Postgres table gives one authoritative counter per
 * (bucket, fixed window).
 *
 * Client IP: Vercel sets `x-forwarded-for` as `client, proxy, …`. We key on the
 * LEFT-MOST entry (the real client). Using the whole header would let an attacker
 * prepend a random value per request to get a fresh bucket every time.
 *
 * Failure mode:
 *   - failOpen: false (default) → on limiter error, REJECT (fail closed). Use for
 *     auth/OTP where an abuse bypass is worse than a transient outage.
 *   - failOpen: true → on limiter error, ALLOW. Use for public best-effort ingestion
 *     (analytics, lead submissions) where availability beats strict limiting.
 */
/**
 * Extract the real client IP from an X-Forwarded-For header. Vercel sets it as
 * `client, proxy, …` so the LEFT-MOST entry is the client. Never use the whole
 * string (an attacker can prepend values to get a fresh limiter bucket each call).
 */
export function leftmostIp(xff: string | undefined | null): string {
  return (xff ?? '').split(',')[0]?.trim() || 'unknown';
}

export function rateLimit(opts: {
  windowMs: number;
  max: number;
  keyPrefix?: string;
  failOpen?: boolean;
}) {
  return createMiddleware(async (c, next) => {
    const clientIp = leftmostIp(c.req.header('x-forwarded-for'));
    const bucket = `${opts.keyPrefix ?? 'rl'}:${clientIp}`;
    // Fixed window aligned to windowMs.
    const windowStart = new Date(Math.floor(Date.now() / opts.windowMs) * opts.windowMs);

    let count: number;
    try {
      // Atomic upsert-and-increment: a single Postgres statement returns the new count.
      const [row] = await db
        .insert(rateLimitHits)
        .values({ bucket, windowStart, count: 1 })
        .onConflictDoUpdate({
          target: [rateLimitHits.bucket, rateLimitHits.windowStart],
          set: { count: sql`${rateLimitHits.count} + 1` },
        })
        .returning({ count: rateLimitHits.count });
      count = row?.count ?? 1;
    } catch (err) {
      // If the rate_limit_hits table doesn't exist yet (migration 0001 not applied),
      // degrade to allow rather than break auth — but log loudly so it's fixed.
      if ((err as { code?: string })?.code === '42P01') {
        logger.error({ bucket }, 'rate-limiter: rate_limit_hits table missing — apply migration 0001. Allowing (degraded).');
        await next();
        return;
      }
      logger.error({ err, bucket }, 'rate-limiter: store error');
      if (opts.failOpen) {
        await next();
        return;
      }
      return c.json(
        { data: null, error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
        429,
      );
    }

    if (count > opts.max) {
      return c.json(
        { data: null, error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
        429,
      );
    }

    await next();
  });
}
