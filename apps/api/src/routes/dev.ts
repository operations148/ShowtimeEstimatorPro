/**
 * Dev-only routes — only mounted when NODE_ENV !== 'production'.
 *
 * POST /dev/simulate-webhook
 *   Directly upserts a subscription row for a tenant with the requested status.
 *   Body: { tenantId: string, status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid' }
 *
 * This is intentionally not secured — it is only available in development and
 * test environments and must NEVER be mounted in production.
 */
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { subscriptions } from '../models/schema';
import type * as schema from '../models/schema';
import { db as realDb } from '../models/db';
import { SUBSCRIPTION_PLAN_ID } from '@repo/shared';

const simulateWebhookSchema = z.object({
  tenantId: z.string().uuid(),
  status: z.enum(['active', 'trialing', 'past_due', 'canceled', 'unpaid']),
});

export function createDevRoutes(db: BetterSQLite3Database<typeof schema>): Hono {
  const app = new Hono();

  app.post('/simulate-webhook', async (c) => {
    const body = await c.req.json();
    const parsed = simulateWebhookSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { data: null, error: { code: 'VALIDATION', message: parsed.error.message } },
        400,
      );
    }

    const { tenantId, status } = parsed.data;
    const now = new Date();
    const currentPeriodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const [existing] = db
      .select({ id: subscriptions.id, externalId: subscriptions.externalId })
      .from(subscriptions)
      .where(eq(subscriptions.tenantId, tenantId))
      .limit(1)
      .all();

    if (existing) {
      db.update(subscriptions)
        .set({ status, currentPeriodEnd, updatedAt: now })
        .where(eq(subscriptions.tenantId, tenantId))
        .run();
    } else {
      db.insert(subscriptions)
        .values({
          tenantId,
          externalId: `dev_sub_${Date.now()}`,
          status,
          planId: SUBSCRIPTION_PLAN_ID,
          currentPeriodEnd,
        })
        .run();
    }

    const [updated] = db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.tenantId, tenantId))
      .limit(1)
      .all();

    return c.json({ data: updated ?? null, error: null });
  });

  return app;
}

export const devRoutes = createDevRoutes(realDb);
