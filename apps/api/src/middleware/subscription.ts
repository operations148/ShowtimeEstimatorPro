import { eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { subscriptions } from '../models/schema';
import type * as schema from '../models/schema';
import type { AuthContext } from './auth';

type SubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Factory that creates subscription-enforcement middleware backed by a real DB.
 *
 * Enforcement rules:
 *   - No subscription row  → allow (new tenant / implicit trial)
 *   - active / trialing    → allow all methods
 *   - past_due             → allow GET only; mutating methods → 402
 *   - canceled / unpaid    → block all authenticated requests → 402
 *
 * The middleware is a no-op when no auth context is present (unauthenticated
 * routes are handled separately by requireAuth).
 */
export function createSubscriptionEnforcement(db: NodePgDatabase<typeof schema>) {
  return createMiddleware<{ Variables: { auth: AuthContext } }>(async (c, next) => {
    const auth = c.get('auth');
    if (!auth) {
      await next();
      return;
    }

    const [sub] = await db
      .select({ status: subscriptions.status })
      .from(subscriptions)
      .where(eq(subscriptions.tenantId, auth.tenantId))
      .limit(1);

    // No subscription row → allow (new tenant or implicit trial period)
    if (!sub) {
      await next();
      return;
    }

    const status = sub.status as SubscriptionStatus;

    if (status === 'active' || status === 'trialing') {
      await next();
      return;
    }

    if (status === 'past_due') {
      if (MUTATING_METHODS.has(c.req.method.toUpperCase())) {
        return c.json(
          {
            data: null,
            error: {
              code: 'PAYMENT_REQUIRED',
              message: 'Subscription past due. Account is in read-only mode.',
            },
          },
          402,
        );
      }
      await next();
      return;
    }

    // canceled or unpaid — block everything
    return c.json(
      {
        data: null,
        error: {
          code: 'PAYMENT_REQUIRED',
          message: 'Subscription inactive. Please renew to continue.',
        },
      },
      402,
    );
  });
}

// Legacy no-op export kept for any callers that haven't been migrated yet.
export const requireActiveSubscription = createMiddleware(async (_c, next) => {
  await next();
});

export const enforceSubscriptionAccess = createMiddleware(async (_c, next) => {
  await next();
});
