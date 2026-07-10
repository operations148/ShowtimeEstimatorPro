import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { subscriptions, processedWebhookEvents } from '../models/schema';
import type * as schema from '../models/schema';
import { requireAuth } from '../middleware/auth';
import { auditLog } from '../middleware/audit';
import { AuditService } from '../services/audit.service';
import type { PaymentProvider } from '@repo/provider-adapters';
import { createPaymentProvider } from '@repo/provider-adapters';
import { db as realDb } from '../models/db';
import { env } from '../env';
import { logger } from '../lib/logger';
import { SUBSCRIPTION_PLAN_ID } from '@repo/shared';

export function createBillingRoutes(
  db: NodePgDatabase<typeof schema>,
  paymentProvider: PaymentProvider,
  auditService?: AuditService,
): Hono {
  const audit = auditService ?? new AuditService(db);
  const app = new Hono();

  // ── GET /subscription — return current subscription status ──────────────────
  app.get('/subscription', requireAuth, async (c) => {
    const auth = c.get('auth');
    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.tenantId, auth.tenantId))
      .limit(1);

    return c.json({ data: sub ?? null, error: null });
  });

  // ── POST /checkout — create Stripe checkout session ──────────────────────────
  app.post('/checkout', requireAuth, auditLog(audit, 'billing.checkout', 'subscription'), async (c) => {
    const auth = c.get('auth');
    const body = (await c.req.json()) as { email?: string };

    const result = await paymentProvider.createCheckoutSession({
      tenantId: auth.tenantId,
      email: body.email ?? '',
      planId: SUBSCRIPTION_PLAN_ID,
      successUrl: `${env.CORS_DASHBOARD_ORIGIN}/settings/billing?success=true`,
      cancelUrl: `${env.CORS_DASHBOARD_ORIGIN}/settings/billing?canceled=true`,
    });

    return c.json({ data: { checkoutUrl: result.url }, error: null });
  });

  // ── POST /webhook — handle payment provider webhook events ───────────────────
  //
  // Supported event types:
  //   subscription.created  — upsert a new subscription row (requires tenantId in data)
  //   subscription.updated  — update status + period end by externalId
  //   subscription.deleted  — set status to 'canceled' by externalId
  app.post('/webhook', async (c) => {
    // SECURITY (C1): the mock provider does not verify signatures. Refuse to process
    // webhooks in production unless the active provider cryptographically verifies the
    // request — otherwise this is an unauthenticated write to the subscriptions table
    // (grant self a subscription / cancel any tenant's by externalId). The signature
    // is the authentication for this CSRF-exempt endpoint.
    if (env.NODE_ENV === 'production' && !paymentProvider.verifiesSignatures) {
      logger.error('billing webhook rejected: no signature-verifying payment provider configured in production');
      return c.json(
        { data: null, error: { code: 'WEBHOOK_DISABLED', message: 'Webhook processing is not available.' } },
        503,
      );
    }

    const rawBody = await c.req.text();
    const signature = c.req.header('stripe-signature') ?? '';

    let event: Awaited<ReturnType<PaymentProvider['constructWebhookEvent']>>;
    try {
      event = await paymentProvider.constructWebhookEvent(rawBody, signature);
    } catch (err) {
      logger.warn({ err }, 'billing webhook: signature verification failed');
      return c.json(
        { data: null, error: { code: 'WEBHOOK_ERROR', message: 'Invalid webhook signature.' } },
        400,
      );
    }

    // Idempotency: process each provider event at most once (dedupe by event id).
    if (event.id) {
      const inserted = await db
        .insert(processedWebhookEvents)
        .values({ id: event.id })
        .onConflictDoNothing()
        .returning({ id: processedWebhookEvents.id });
      if (inserted.length === 0) {
        return c.json({ data: { received: true, duplicate: true }, error: null });
      }
    }

    try {
      const { type, data } = event;

      if (type === 'subscription.created') {
        // tenantId must be present in the event metadata for us to associate
        // the subscription with the right tenant.
        if (!data.tenantId) {
          logger.warn({ eventType: type }, 'billing webhook: subscription.created missing tenantId — skipping');
          return c.json({ data: { received: true }, error: null });
        }

        const periodEnd = new Date(data.currentPeriodEnd);
        const planId = data.planId ?? SUBSCRIPTION_PLAN_ID;

        // Upsert: if a row already exists for this externalId, update it;
        // otherwise insert a new one.
        const [existing] = await db
          .select({ id: subscriptions.id })
          .from(subscriptions)
          .where(eq(subscriptions.externalId, data.subscriptionId))
          .limit(1);

        if (existing) {
          await db
            .update(subscriptions)
            .set({ status: data.status, currentPeriodEnd: periodEnd, updatedAt: new Date() })
            .where(eq(subscriptions.externalId, data.subscriptionId));
        } else {
          await db.insert(subscriptions).values({
            tenantId: data.tenantId,
            externalId: data.subscriptionId,
            status: data.status,
            planId,
            currentPeriodEnd: periodEnd,
          });
        }
      } else if (type === 'subscription.updated') {
        await db
          .update(subscriptions)
          .set({
            status: data.status,
            currentPeriodEnd: new Date(data.currentPeriodEnd),
            updatedAt: new Date(),
          })
          .where(eq(subscriptions.externalId, data.subscriptionId));
      } else if (type === 'subscription.deleted') {
        await db
          .update(subscriptions)
          .set({ status: 'canceled', updatedAt: new Date() })
          .where(eq(subscriptions.externalId, data.subscriptionId));
      }
      // Unknown event types are silently accepted (forward-compatible).

      return c.json({ data: { received: true }, error: null });
    } catch (err) {
      logger.error({ err }, 'billing webhook: processing error');
      return c.json(
        { data: null, error: { code: 'WEBHOOK_ERROR', message: 'Webhook processing failed.' } },
        400,
      );
    }
  });

  // ── POST /portal — redirect to customer billing portal ───────────────────────
  app.post('/portal', requireAuth, auditLog(audit, 'billing.portal', 'subscription'), async (c) => {
    const auth = c.get('auth');
    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.tenantId, auth.tenantId))
      .limit(1);

    if (!sub) {
      return c.json(
        { data: null, error: { code: 'NO_SUBSCRIPTION', message: 'No subscription found.' } },
        404,
      );
    }

    const result = await paymentProvider.createPortalSession(
      sub.externalId,
      `${env.CORS_DASHBOARD_ORIGIN}/settings/billing`,
    );

    return c.json({ data: { portalUrl: result.url }, error: null });
  });

  return app;
}

export const billingRoutes = createBillingRoutes(
  realDb,
  createPaymentProvider(env.PAYMENT_PROVIDER),
  new AuditService(realDb),
);
