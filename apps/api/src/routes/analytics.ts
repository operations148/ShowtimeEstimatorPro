import { Hono } from 'hono';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { analyticsEventSchema } from '@repo/shared';
import { AnalyticsService } from '../services/analytics.service';
import { requireAuth } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limiter';
import { db as realDb } from '../models/db';
import type * as schema from '../models/schema';

export function createAnalyticsRoutes(
  db: BetterSQLite3Database<typeof schema>,
): Hono {
  const app = new Hono();
  const analyticsService = new AnalyticsService(db);

  // Track event (public, called by widget)
  // Rate limited to 60 events per IP per minute.
  app.post('/events', rateLimit({ windowMs: 60_000, max: 60, keyPrefix: 'analytics' }), async (c) => {
    const body = await c.req.json();
    const parsed = analyticsEventSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { data: null, error: { code: 'VALIDATION', message: parsed.error.message } },
        400,
      );
    }

    // tenantId is resolved from the body; production should look it up from the estimator
    analyticsService.track({
      tenantId: (body as Record<string, unknown>).tenantId as string ?? 'unknown',
      ...parsed.data,
    });

    return c.json({ data: { tracked: true }, error: null });
  });

  // Get analytics summary (authenticated)
  app.get('/summary', requireAuth, (c) => {
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

    const summary = analyticsService.getSummary(auth.tenantId, {
      estimatorId: estimatorId ?? undefined,
      from,
      to,
    });

    return c.json({ data: summary, error: null });
  });

  return app;
}

export const analyticsRoutes = createAnalyticsRoutes(realDb);
