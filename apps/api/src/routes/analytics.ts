import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { analyticsEventSchema } from '@repo/shared';
import { AnalyticsService } from '../services/analytics.service';
import { estimators } from '../models/schema';
import { requireAuth } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limiter';
import { db as realDb } from '../models/db';
import type * as schema from '../models/schema';

export function createAnalyticsRoutes(
  db: NodePgDatabase<typeof schema>,
): Hono {
  const app = new Hono();
  const analyticsService = new AnalyticsService(db);

  // Track event (public, called by widget)
  // Rate limited to 60 events per IP per minute.
  app.post('/events', rateLimit({ windowMs: 60_000, max: 60, keyPrefix: 'analytics', failOpen: true }), async (c) => {
    const body = await c.req.json();
    const parsed = analyticsEventSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { data: null, error: { code: 'VALIDATION', message: parsed.error.message } },
        400,
      );
    }

    // SECURITY: never trust a client-supplied tenantId — it would let anyone inject
    // analytics rows against another tenant. Resolve the tenant authoritatively from
    // the estimator the event references. Unknown estimator → silently ignore.
    const [est] = await db
      .select({ tenantId: estimators.tenantId })
      .from(estimators)
      .where(eq(estimators.id, parsed.data.estimatorId))
      .limit(1);

    if (!est) {
      return c.json({ data: { tracked: false }, error: null });
    }

    // Awaited (not fire-and-forget): on Vercel's serverless runtime the function is
    // frozen the moment the response is sent, so any unawaited async work in flight
    // never completes — and worse, it can leave a DB connection checked out of the
    // pool forever. Errors are still swallowed so a tracking failure never fails the
    // widget's request.
    await analyticsService
      .track({ tenantId: est.tenantId, ...parsed.data })
      .catch(() => {});

    return c.json({ data: { tracked: true }, error: null });
  });

  // Get analytics summary (authenticated)
  app.get('/summary', requireAuth, async (c) => {
    const auth = c.get('auth');
    const estimatorId = c.req.query('estimatorId');
    const fromParam = c.req.query('from');
    const toParam = c.req.query('to');

    // Validate date params if provided
    let from: Date | undefined;
    let to: Date | undefined;

    if (fromParam) {
      const d = new Date(fromParam);
      if (isNaN(d.getTime())) {
        return c.json(
          { data: null, error: { code: 'VALIDATION', message: 'Invalid "from" date' } },
          400,
        );
      }
      from = d;
    }

    if (toParam) {
      const d = new Date(toParam);
      if (isNaN(d.getTime())) {
        return c.json(
          { data: null, error: { code: 'VALIDATION', message: 'Invalid "to" date' } },
          400,
        );
      }
      to = d;
    }

    const summary = await analyticsService.getSummary(auth.tenantId, {
      estimatorId: estimatorId ?? undefined,
      from,
      to,
    });

    return c.json({ data: summary, error: null });
  });

  return app;
}

export const analyticsRoutes = createAnalyticsRoutes(realDb);
