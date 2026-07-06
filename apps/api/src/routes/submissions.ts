import { Hono } from 'hono';
import { eq, and, desc } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { estimators, submissions, tenants } from '../models/schema';
import type * as schema from '../models/schema';
import { createSubmissionSchema } from '@repo/shared';
import type { PricingInput } from '@repo/shared';
import { stripHtml } from '../utils/sanitize';
import { PricingService } from '../services/pricing.service';
import { ServiceAreaService } from '../services/service-area.service';
import { AnalyticsService } from '../services/analytics.service';
import { NotificationService } from '../services/notification.service';
import { IntegrationDispatchService } from '../services/integration.service';
import { createEmailProvider } from '@repo/provider-adapters';
import type { EmailProvider } from '@repo/provider-adapters';
import { env } from '../env';
import { requireAuth } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limiter';
import { auditLog } from '../middleware/audit';
import { logger } from '../lib/logger';
import { AuditService } from '../services/audit.service';
import { db as realDb } from '../models/db';

export function createSubmissionRoutes(
  db: BetterSQLite3Database<typeof schema>,
  emailProvider?: EmailProvider,
  auditService?: AuditService,
): Hono {
  const provider = emailProvider ?? createEmailProvider(env.EMAIL_PROVIDER);
  const audit = auditService ?? new AuditService(db);
  const pricingService = new PricingService(db);
  const serviceAreaService = new ServiceAreaService(db);
  const analyticsService = new AnalyticsService(db);
  const notificationService = new NotificationService(provider);
  const integrationDispatch = new IntegrationDispatchService();

  const app = new Hono();

  /**
   * POST /
   * Public endpoint: called by the widget to submit an estimate.
   * Rate limited to 20 submissions per IP per minute.
   */
  app.post('/', rateLimit({ windowMs: 60_000, max: 20, keyPrefix: 'sub' }), async (c) => {
    const body = await c.req.json();

    // Honeypot spam trap: a hidden `company` field that legitimate users never
    // fill. If populated, silently accept and drop (don't tip off the bot).
    const honeypot = (body as Record<string, unknown>).company;
    if (typeof honeypot === 'string' && honeypot.trim() !== '') {
      logger.warn('Submission rejected: honeypot filled (likely spam)');
      return c.json(
        { data: { submissionId: 'blocked', estimate: { min: 0, max: 0, currency: 'USD' } }, error: null },
        201,
      );
    }

    const parsed = createSubmissionSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { data: null, error: { code: 'VALIDATION', message: parsed.error.message } },
        400,
      );
    }

    // Look up estimator by public key
    const [est] = db
      .select()
      .from(estimators)
      .where(eq(estimators.publicKey, parsed.data.estimatorPublicKey))
      .limit(1)
      .all();

    if (!est) {
      return c.json(
        { data: null, error: { code: 'NOT_FOUND', message: 'Estimator not found.' } },
        404,
      );
    }

    // Service area check — only when the lead provided a zip. Zip is optional,
    // so a submission without one is never gated.
    const leadZip = parsed.data.lead.zip?.trim();
    const isServed = leadZip ? serviceAreaService.isZipServed(est.tenantId, leadZip) : true;
    const [tenant] = db
      .select()
      .from(tenants)
      .where(eq(tenants.id, est.tenantId))
      .limit(1)
      .all();

    if (leadZip && !isServed && tenant?.serviceAreaBehavior === 'block') {
      analyticsService.track({
        tenantId: est.tenantId,
        estimatorId: est.id,
        eventType: 'gated_out',
        sessionId: (body as Record<string, unknown>).sessionId as string ?? 'unknown',
      });

      return c.json(
        {
          data: null,
          error: { code: 'OUT_OF_AREA', message: 'This zip code is outside our service area.' },
        },
        422,
      );
    }

    // Extract pricing input from answers.
    // The widget sends answers keyed by question UUID (e.g. { "4f0e...": "Pool Only", ... }).
    // We resolve pricing keys by matching answer values against the pricing config's
    // known base/size/addon keys — no reliance on hardcoded step IDs.
    const answers = parsed.data.answers as Record<string, unknown>;

    const pricingConfigResult = pricingService.getConfig(est.tenantId, est.id);
    let pricingInput: PricingInput = { baseKey: '', sizeKey: '', addonKeys: [] };

    if (pricingConfigResult.ok) {
      const cfg = pricingConfigResult.value;
      const baseKeys = Object.keys(cfg.base);
      const allSizeKeys = Object.values(cfg.base).flatMap(Object.keys);
      const addonKeySet = new Set(Object.keys(cfg.addons));

      // Flatten all answer values (single string or array of strings)
      const allValues: string[] = Object.values(answers).flatMap((v) =>
        Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : [],
      );

      pricingInput = {
        baseKey: allValues.find((v) => baseKeys.includes(v)) ?? '',
        sizeKey: allValues.find((v) => allSizeKeys.includes(v)) ?? '',
        addonKeys: allValues.filter((v) => addonKeySet.has(v)),
      };
    }

    const priceResult = await pricingService.compute(est.tenantId, est.id, pricingInput);
    const estimate = priceResult.ok
      ? priceResult.value
      : { min: 0, max: 0, currency: 'USD' };

    // Sanitize lead fields before persisting. Zip is optional (null when omitted).
    const lead = {
      email: stripHtml(parsed.data.lead.email),
      zip: parsed.data.lead.zip != null ? stripHtml(parsed.data.lead.zip) : null,
      name: parsed.data.lead.name != null ? stripHtml(parsed.data.lead.name) : null,
      phone: parsed.data.lead.phone != null ? stripHtml(parsed.data.lead.phone) : null,
    };

    // Persist submission
    const [submission] = db
      .insert(submissions)
      .values({
        tenantId: est.tenantId,
        estimatorId: est.id,
        versionId: est.currentVersionId ?? est.id,
        leadEmail: lead.email,
        leadZip: lead.zip,
        leadName: lead.name,
        leadPhone: lead.phone,
        answers: parsed.data.answers,
        estimateMin: estimate.min,
        estimateMax: estimate.max,
        currency: estimate.currency,
        serviceAreaValid: isServed,
      })
      .returning()
      .all();

    // Track submit event (fire-and-forget)
    analyticsService.track({
      tenantId: est.tenantId,
      estimatorId: est.id,
      eventType: 'submit',
      sessionId: (body as Record<string, unknown>).sessionId as string ?? 'unknown',
    });

    // Notify tenant recipients (fire-and-forget)
    const recipients = tenant?.notificationRecipients as string[] | undefined;
    if (recipients && recipients.length > 0) {
      notificationService
        .notifyNewLead(
          recipients.map((email) => ({ email })),
          {
            tenantName: tenant!.name,
            estimatorTitle: est.title,
            lead,
            estimateMin: estimate.min,
            estimateMax: estimate.max,
            currency: estimate.currency,
            submittedAt: new Date(),
          },
        )
        .catch((e) => logger.error({ err: e }, 'NotificationService: failed to send lead notification'));
    }

    // Dispatch to CRM integrations (fire-and-forget). Gated on the tenant's
    // integration config — independent of notificationRecipients.
    if (tenant?.integrations) {
      integrationDispatch
        .dispatchNewLead(tenant.integrations, {
          submissionId: submission!.id,
          name: lead.name,
          phone: lead.phone,
          email: lead.email,
          zip: lead.zip,
          estimatorTitle: est.title,
          estimateMin: estimate.min,
          estimateMax: estimate.max,
          currency: estimate.currency,
          answers: parsed.data.answers,
          submittedAt: new Date(),
        })
        .catch((e) => logger.error({ err: e }, 'IntegrationDispatchService: failed to dispatch lead'));
    }

    return c.json(
      {
        data: {
          submissionId: submission!.id,
          estimate: { min: estimate.min, max: estimate.max, currency: estimate.currency },
        },
        error: null,
      },
      201,
    );
  });

  // GET / — list submissions (authenticated, tenant-scoped)
  app.get('/', requireAuth, (c) => {
    const auth = c.get('auth');
    const rows = db
      .select()
      .from(submissions)
      .where(eq(submissions.tenantId, auth.tenantId))
      .orderBy(desc(submissions.createdAt))
      .all();
    return c.json({ data: rows, error: null });
  });

  // GET /export — GDPR right-of-access JSON export (authenticated, tenant-scoped).
  // Returns all submissions for this tenant as a JSON array suitable for data portability.
  // Registered before DELETE /:id to avoid Hono treating "export" as an :id segment.
  app.get('/export', requireAuth, auditLog(audit, 'export.download_json', 'export'), (c) => {
    const auth = c.get('auth');
    const estimatorId = c.req.query('estimatorId');
    const fromParam = c.req.query('from');
    const toParam = c.req.query('to');

    let from: Date | undefined;
    let to: Date | undefined;

    if (fromParam) {
      const d = new Date(fromParam);
      if (isNaN(d.getTime())) {
        return c.json({ data: null, error: { code: 'VALIDATION', message: 'Invalid "from" date' } }, 400);
      }
      from = d;
    }

    if (toParam) {
      const d = new Date(toParam);
      if (isNaN(d.getTime())) {
        return c.json({ data: null, error: { code: 'VALIDATION', message: 'Invalid "to" date' } }, 400);
      }
      to = d;
    }

    let query = db
      .select()
      .from(submissions)
      .where(eq(submissions.tenantId, auth.tenantId))
      .$dynamic();

    if (estimatorId) {
      query = query.where(and(
        eq(submissions.tenantId, auth.tenantId),
        eq(submissions.estimatorId, estimatorId),
      ));
    }

    const rows = query.orderBy(desc(submissions.createdAt)).all();

    // Apply date filters after fetch (simpler than conditional Drizzle chain)
    const filtered = rows.filter((r) => {
      if (from && r.createdAt < from) return false;
      if (to && r.createdAt > to) return false;
      return true;
    });

    const filename = `submissions-${new Date().toISOString().slice(0, 10)}.json`;
    return new Response(JSON.stringify({ data: filtered, exportedAt: new Date().toISOString() }), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  });

  // DELETE /:id — hard delete (authenticated, tenant-scoped)
  app.delete('/:id', requireAuth, auditLog(audit, 'submission.delete', 'submission'), (c) => {
    const auth = c.get('auth');
    const [existing] = db
      .select()
      .from(submissions)
      .where(and(eq(submissions.id, c.req.param('id')), eq(submissions.tenantId, auth.tenantId)))
      .limit(1)
      .all();

    if (!existing) {
      return c.json(
        { data: null, error: { code: 'NOT_FOUND', message: 'Submission not found.' } },
        404,
      );
    }

    db.delete(submissions)
      .where(and(eq(submissions.id, existing.id), eq(submissions.tenantId, auth.tenantId)))
      .run();

    return c.json({ data: { deleted: true }, error: null });
  });

  return app;
}

// ── Default export: wired to real DB ─────────────────────────────────────────

export const submissionRoutes = createSubmissionRoutes(realDb, undefined, new AuditService(realDb));
