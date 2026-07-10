import { Hono } from 'hono';
import { isNotNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { tenants } from '../models/schema';
import type * as schema from '../models/schema';
import { RetentionService } from '../services/retention.service';
import { db as realDb } from '../models/db';
import { env } from '../env';
import { logger } from '../lib/logger';

/**
 * Scheduled maintenance endpoints (M3). Authenticated by a shared secret, not a user
 * session — Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
 */
export function createCronRoutes(db: NodePgDatabase<typeof schema>): Hono {
  const app = new Hono();

  // GET /retention — purge submissions older than each tenant's configured retention.
  app.get('/retention', async (c) => {
    const provided = c.req.header('authorization') ?? '';
    if (!env.CRON_SECRET || provided !== `Bearer ${env.CRON_SECRET}`) {
      return c.json(
        { data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or missing cron secret.' } },
        401,
      );
    }

    const retention = new RetentionService(db);
    const rows = await db
      .select({ id: tenants.id, retentionDays: tenants.retentionDays })
      .from(tenants)
      .where(isNotNull(tenants.retentionDays));

    let submissionsPurged = 0;
    for (const t of rows) {
      if (t.retentionDays && t.retentionDays > 0) {
        submissionsPurged += await retention.purgeExpired(t.id, t.retentionDays);
      }
    }

    logger.info({ tenantsProcessed: rows.length, submissionsPurged }, 'retention purge complete');
    return c.json({ data: { tenantsProcessed: rows.length, submissionsPurged }, error: null });
  });

  return app;
}

export const cronRoutes = createCronRoutes(realDb);
