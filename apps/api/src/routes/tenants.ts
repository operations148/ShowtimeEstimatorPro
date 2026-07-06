import { Hono } from 'hono';
import { eq, and, ne } from 'drizzle-orm';
import { deleteCookie } from 'hono/cookie';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  tenants,
  users,
  submissions,
  analyticsEvents,
  estimatorVersions,
  estimators,
  pricingConfigs,
  serviceAreas,
  subscriptions,
  auditLogs,
} from '../models/schema';
import type * as schema from '../models/schema';
import { signupSchema, updateTenantSchema, SESSION_COOKIE_NAME } from '@repo/shared';
import { stripHtml } from '../utils/sanitize';
import { requireAuth, requireRole } from '../middleware/auth';
import { AuditService } from '../services/audit.service';
import { AuthService } from '../services/auth.service';
import { db as realDb } from '../models/db';
import { createEmailProvider, createSmsProvider } from '@repo/provider-adapters';
import { env } from '../env';

export function createTenantRoutes(
  db: BetterSQLite3Database<typeof schema>,
  authService: AuthService,
  auditService?: AuditService,
): Hono {
  const audit = auditService ?? new AuditService(db);
  const app = new Hono();

  // POST /signup — create tenant + owner, auto-trigger OTP
  app.post('/signup', async (c) => {
    const body = await c.req.json();
    const parsed = signupSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { data: null, error: { code: 'VALIDATION', message: parsed.error.message } },
        400,
      );
    }

    const { ownerEmail, ...rawTenantData } = parsed.data;
    const tenantData = { ...rawTenantData, name: stripHtml(rawTenantData.name) };

    const existing = db
      .select()
      .from(tenants)
      .where(eq(tenants.slug, tenantData.slug))
      .limit(1)
      .all();
    if (existing.length > 0) {
      return c.json(
        { data: null, error: { code: 'CONFLICT', message: 'Slug already taken.' } },
        409,
      );
    }

    const [tenant] = db.insert(tenants).values(tenantData).returning().all();
    const [owner] = db
      .insert(users)
      .values({ tenantId: tenant!.id, email: ownerEmail, role: 'owner' })
      .returning()
      .all();

    const otpResult = await authService.requestOtp(ownerEmail, 'email');
    const otp = otpResult.ok ? { expiresAt: otpResult.value.expiresAt } : null;

    return c.json({ data: { tenant, owner, otp }, error: null }, 201);
  });

  // GET /me — current tenant details (auth required)
  app.get('/me', requireAuth, async (c) => {
    const auth = c.get('auth');
    const [tenant] = db
      .select()
      .from(tenants)
      .where(eq(tenants.id, auth.tenantId))
      .limit(1)
      .all();
    if (!tenant) {
      return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Tenant not found.' } }, 404);
    }
    return c.json({ data: tenant, error: null });
  });

  // PATCH /me — update tenant settings (owner/admin only)
  app.patch('/me', requireAuth, requireRole('owner', 'admin'), async (c) => {
    const auth = c.get('auth');
    const body = await c.req.json();
    const parsed = updateTenantSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { data: null, error: { code: 'VALIDATION', message: parsed.error.message } },
        400,
      );
    }

    const sanitized = {
      ...parsed.data,
      ...(parsed.data.name !== undefined ? { name: stripHtml(parsed.data.name) } : {}),
    };

    const [updated] = db
      .update(tenants)
      .set({ ...sanitized, updatedAt: new Date() })
      .where(eq(tenants.id, auth.tenantId))
      .returning()
      .all();

    return c.json({ data: updated, error: null });
  });

  // DELETE /me/data — GDPR Art. 17 bulk erasure of all tenant data.
  //
  // Deletes, in dependency order:
  //   submissions → analytics events → estimator versions → pricing configs
  //   → estimators → service areas → subscriptions → audit logs
  //   → all other users → tenant (which cascades the requesting user in production)
  //
  // The audit log entry is written BEFORE any deletion so the action is
  // permanently on record even when the audit logs are subsequently cleared.
  //
  // Requires owner role and explicit confirmation: { confirm: "DELETE_ALL_DATA" }
  app.delete(
    '/me/data',
    requireAuth,
    requireRole('owner'),
    async (c) => {
      const auth = c.get('auth');
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

      if (body['confirm'] !== 'DELETE_ALL_DATA') {
        return c.json(
          {
            data: null,
            error: {
              code: 'CONFIRMATION_REQUIRED',
              message: 'Send { "confirm": "DELETE_ALL_DATA" } in the request body to proceed.',
            },
          },
          400,
        );
      }

      const { tenantId, userId } = auth;
      const ip = c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? undefined;

      // ── 1. Write audit entry BEFORE touching anything ──────────────────────
      // This entry must survive even if the subsequent deletes fail mid-way.
      audit.logAction({
        tenantId,
        actorId: userId,
        action: 'tenant.data_deletion',
        resourceType: 'tenant',
        resourceId: tenantId,
        ipAddress: ip,
        userAgent: c.req.header('user-agent') ?? undefined,
      });

      // ── 2. Delete leaf data first, then work up to the tenant ─────────────
      db.delete(submissions).where(eq(submissions.tenantId, tenantId)).run();
      db.delete(analyticsEvents).where(eq(analyticsEvents.tenantId, tenantId)).run();
      db.delete(serviceAreas).where(eq(serviceAreas.tenantId, tenantId)).run();
      db.delete(pricingConfigs).where(eq(pricingConfigs.tenantId, tenantId)).run();

      // estimatorVersions → estimators (version rows reference estimator rows)
      const tenantEstimatorIds = db
        .select({ id: estimators.id })
        .from(estimators)
        .where(eq(estimators.tenantId, tenantId))
        .all()
        .map((r) => r.id);

      for (const estId of tenantEstimatorIds) {
        db.delete(estimatorVersions)
          .where(eq(estimatorVersions.estimatorId, estId))
          .run();
      }

      db.delete(estimators).where(eq(estimators.tenantId, tenantId)).run();
      db.delete(subscriptions).where(eq(subscriptions.tenantId, tenantId)).run();
      db.delete(auditLogs).where(eq(auditLogs.tenantId, tenantId)).run();

      // Delete all users except the requesting user, then delete the tenant.
      // Deleting the tenant cascades to the requesting user in Postgres (FK ON DELETE CASCADE).
      // In SQLite dev the user row will be orphaned, which is acceptable since the session
      // is invalidated immediately after this response.
      db.delete(users)
        .where(and(eq(users.tenantId, tenantId), ne(users.id, userId)))
        .run();

      db.delete(tenants).where(eq(tenants.id, tenantId)).run();

      // ── 3. Invalidate the session cookie ──────────────────────────────────
      deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });

      return c.json({
        data: { deleted: true, tenantId },
        error: null,
      });
    },
  );

  return app;
}

// ── Default export: wired to real DB + production providers ──────────────────

const _authService = new AuthService(
  realDb,
  createEmailProvider(env.EMAIL_PROVIDER),
  createSmsProvider(env.SMS_PROVIDER),
);

export const tenantRoutes = createTenantRoutes(realDb, _authService, new AuditService(realDb));
