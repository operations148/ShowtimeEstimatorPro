import { Hono } from 'hono';
import { eq, and, desc } from 'drizzle-orm';
import * as crypto from 'crypto';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { estimators, estimatorVersions } from '../models/schema';
import type * as schema from '../models/schema';
import {
  createEstimatorSchema,
  updateEstimatorSchema,
  questionsArraySchema,
  pricingConfigSchema,
} from '@repo/shared';
import { stripHtml } from '../utils/sanitize';
import { requireAuth } from '../middleware/auth';
import { createSubscriptionEnforcement } from '../middleware/subscription';
import { auditLog } from '../middleware/audit';
import { AuditService } from '../services/audit.service';
import { db as realDb } from '../models/db';
import { env } from '../env';
import { PricingService } from '../services/pricing.service';

export function createEstimatorRoutes(
  db: NodePgDatabase<typeof schema>,
  pricing?: PricingService,
  auditService?: AuditService,
): Hono {
  const pricingService = pricing ?? new PricingService(db);
  const audit = auditService ?? new AuditService(db);
  const app = new Hono();

  // Auth + subscription enforcement applied globally for all estimator routes.
  app.use('*', requireAuth);
  app.use('*', createSubscriptionEnforcement(db));

  // ── GET / — list all estimators for tenant ───────────────────────────────
  app.get('/', requireAuth, async (c) => {
    const auth = c.get('auth');
    const rows = await db
      .select()
      .from(estimators)
      .where(eq(estimators.tenantId, auth.tenantId))
      .orderBy(desc(estimators.createdAt));
    return c.json({ data: rows, error: null });
  });

  // ── POST / — create estimator with auto-generated publicKey + draft v1 ──
  app.post('/', requireAuth, auditLog(audit, 'estimator.create', 'estimator'), async (c) => {
    const auth = c.get('auth');
    const body = await c.req.json();
    const parsed = createEstimatorSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { data: null, error: { code: 'VALIDATION', message: parsed.error.message } },
        400,
      );
    }

    const publicKey = crypto.randomBytes(16).toString('hex');

    const [estimator] = await db
      .insert(estimators)
      .values({
        ...parsed.data,
        title: stripHtml(parsed.data.title),
        tenantId: auth.tenantId,
        publicKey,
        branding: parsed.data.branding ?? {},
      })
      .returning();

    const [version] = await db
      .insert(estimatorVersions)
      .values({ estimatorId: estimator!.id, version: 1, questions: [] })
      .returning();

    const [linked] = await db
      .update(estimators)
      .set({ currentVersionId: version!.id })
      .where(eq(estimators.id, estimator!.id))
      .returning();

    return c.json({ data: { ...linked, questions: [] }, error: null }, 201);
  });

  // ── GET /:id — estimator detail with current version's questions ─────────
  app.get('/:id', requireAuth, async (c) => {
    const auth = c.get('auth');
    const [est] = await db
      .select()
      .from(estimators)
      .where(and(eq(estimators.id, c.req.param('id')), eq(estimators.tenantId, auth.tenantId)))
      .limit(1);

    if (!est) {
      return c.json(
        { data: null, error: { code: 'NOT_FOUND', message: 'Estimator not found.' } },
        404,
      );
    }

    const questions = est.currentVersionId
      ? (
          await db
            .select()
            .from(estimatorVersions)
            .where(eq(estimatorVersions.id, est.currentVersionId))
            .limit(1)
        )[0]?.questions ?? []
      : [];

    return c.json({ data: { ...est, questions }, error: null });
  });

  // ── PATCH /:id — update title / branding ─────────────────────────────────
  app.patch('/:id', requireAuth, auditLog(audit, 'estimator.update', 'estimator'), async (c) => {
    const auth = c.get('auth');
    const body = await c.req.json();
    const parsed = updateEstimatorSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { data: null, error: { code: 'VALIDATION', message: parsed.error.message } },
        400,
      );
    }

    const sanitized = {
      ...parsed.data,
      ...(parsed.data.title !== undefined ? { title: stripHtml(parsed.data.title) } : {}),
    };

    const [updated] = await db
      .update(estimators)
      .set({ ...sanitized, updatedAt: new Date() })
      .where(and(eq(estimators.id, c.req.param('id')), eq(estimators.tenantId, auth.tenantId)))
      .returning();

    if (!updated) {
      return c.json(
        { data: null, error: { code: 'NOT_FOUND', message: 'Estimator not found.' } },
        404,
      );
    }
    return c.json({ data: updated, error: null });
  });

  // ── PUT /:id/questions — update questions on current draft version ────────
  // If the estimator is published, auto-forks a new draft version first.
  app.put('/:id/questions', requireAuth, auditLog(audit, 'estimator.update_questions', 'estimator'), async (c) => {
    const auth = c.get('auth');
    const id = c.req.param('id');
    const body = await c.req.json();
    const parsed = questionsArraySchema.safeParse(body.questions);
    if (!parsed.success) {
      return c.json(
        { data: null, error: { code: 'VALIDATION', message: parsed.error.message } },
        400,
      );
    }

    const [est] = await db
      .select()
      .from(estimators)
      .where(and(eq(estimators.id, id), eq(estimators.tenantId, auth.tenantId)))
      .limit(1);

    if (!est || !est.currentVersionId) {
      return c.json(
        { data: null, error: { code: 'NOT_FOUND', message: 'Estimator not found.' } },
        404,
      );
    }

    let targetVersionId = est.currentVersionId;

    // Published version is locked — auto-fork a new draft version
    if (est.status === 'published') {
      const existingVersionNums = await db
        .select({ v: estimatorVersions.version })
        .from(estimatorVersions)
        .where(eq(estimatorVersions.estimatorId, id));
      const nextNum =
        existingVersionNums.length > 0
          ? Math.max(...existingVersionNums.map((r) => r.v)) + 1
          : 2;

      const currentQuestions =
        (
          await db
            .select()
            .from(estimatorVersions)
            .where(eq(estimatorVersions.id, est.currentVersionId))
            .limit(1)
        )[0]?.questions ?? [];

      const [newVersion] = await db
        .insert(estimatorVersions)
        .values({ estimatorId: id, version: nextNum, questions: currentQuestions })
        .returning();

      await db
        .update(estimators)
        .set({ currentVersionId: newVersion!.id, status: 'draft', updatedAt: new Date() })
        .where(eq(estimators.id, id));

      targetVersionId = newVersion!.id;
    }

    const [updatedVersion] = await db
      .update(estimatorVersions)
      .set({ questions: parsed.data })
      .where(eq(estimatorVersions.id, targetVersionId))
      .returning();

    return c.json({ data: updatedVersion, error: null });
  });

  // ── POST /:id/publish — publish and lock current version ─────────────────
  app.post('/:id/publish', requireAuth, auditLog(audit, 'estimator.publish', 'estimator'), async (c) => {
    const auth = c.get('auth');
    const [est] = await db
      .select()
      .from(estimators)
      .where(and(eq(estimators.id, c.req.param('id')), eq(estimators.tenantId, auth.tenantId)))
      .limit(1);

    if (!est) {
      return c.json(
        { data: null, error: { code: 'NOT_FOUND', message: 'Estimator not found.' } },
        404,
      );
    }

    const [updated] = await db
      .update(estimators)
      .set({ status: 'published', updatedAt: new Date() })
      .where(eq(estimators.id, est.id))
      .returning();

    return c.json({ data: updated, error: null });
  });

  // ── POST /:id/unpublish — revert to draft ────────────────────────────────
  app.post('/:id/unpublish', requireAuth, auditLog(audit, 'estimator.unpublish', 'estimator'), async (c) => {
    const auth = c.get('auth');
    const [est] = await db
      .select()
      .from(estimators)
      .where(and(eq(estimators.id, c.req.param('id')), eq(estimators.tenantId, auth.tenantId)))
      .limit(1);

    if (!est) {
      return c.json(
        { data: null, error: { code: 'NOT_FOUND', message: 'Estimator not found.' } },
        404,
      );
    }

    const [updated] = await db
      .update(estimators)
      .set({ status: 'draft', updatedAt: new Date() })
      .where(eq(estimators.id, est.id))
      .returning();

    return c.json({ data: updated, error: null });
  });

  // ── DELETE /:id — hard delete ────────────────────────────────────────────
  app.delete('/:id', requireAuth, auditLog(audit, 'estimator.delete', 'estimator'), async (c) => {
    const auth = c.get('auth');
    const [est] = await db
      .select()
      .from(estimators)
      .where(and(eq(estimators.id, c.req.param('id')), eq(estimators.tenantId, auth.tenantId)))
      .limit(1);

    if (!est) {
      return c.json(
        { data: null, error: { code: 'NOT_FOUND', message: 'Estimator not found.' } },
        404,
      );
    }

    await db
      .delete(estimators)
      .where(and(eq(estimators.id, est.id), eq(estimators.tenantId, auth.tenantId)));

    return c.json({ data: { deleted: true }, error: null });
  });

  // ── POST /:id/versions — explicitly fork a new draft version ────────────
  app.post('/:id/versions', requireAuth, auditLog(audit, 'estimator.fork_version', 'estimator'), async (c) => {
    const auth = c.get('auth');
    const id = c.req.param('id');

    const [est] = await db
      .select()
      .from(estimators)
      .where(and(eq(estimators.id, id), eq(estimators.tenantId, auth.tenantId)))
      .limit(1);

    if (!est || !est.currentVersionId) {
      return c.json(
        { data: null, error: { code: 'NOT_FOUND', message: 'Estimator not found.' } },
        404,
      );
    }

    const existingVersionNums = await db
      .select({ v: estimatorVersions.version })
      .from(estimatorVersions)
      .where(eq(estimatorVersions.estimatorId, id));
    const nextNum =
      existingVersionNums.length > 0
        ? Math.max(...existingVersionNums.map((r) => r.v)) + 1
        : 2;

    const currentQuestions =
      (
        await db
          .select()
          .from(estimatorVersions)
          .where(eq(estimatorVersions.id, est.currentVersionId))
          .limit(1)
      )[0]?.questions ?? [];

    const [newVersion] = await db
      .insert(estimatorVersions)
      .values({ estimatorId: id, version: nextNum, questions: currentQuestions })
      .returning();

    await db
      .update(estimators)
      .set({ currentVersionId: newVersion!.id, status: 'draft', updatedAt: new Date() })
      .where(eq(estimators.id, id));

    return c.json({ data: newVersion, error: null }, 201);
  });

  // ── GET /:id/versions — list all versions ───────────────────────────────
  app.get('/:id/versions', requireAuth, async (c) => {
    const auth = c.get('auth');
    const id = c.req.param('id');

    const [est] = await db
      .select()
      .from(estimators)
      .where(and(eq(estimators.id, id), eq(estimators.tenantId, auth.tenantId)))
      .limit(1);

    if (!est) {
      return c.json(
        { data: null, error: { code: 'NOT_FOUND', message: 'Estimator not found.' } },
        404,
      );
    }

    const versions = await db
      .select()
      .from(estimatorVersions)
      .where(eq(estimatorVersions.estimatorId, id))
      .orderBy(desc(estimatorVersions.version));

    return c.json({ data: versions, error: null });
  });

  // ── GET /:id/embed-code — return HTML embed snippet ──────────────────────
  app.get('/:id/embed-code', requireAuth, async (c) => {
    const auth = c.get('auth');
    const [est] = await db
      .select()
      .from(estimators)
      .where(and(eq(estimators.id, c.req.param('id')), eq(estimators.tenantId, auth.tenantId)))
      .limit(1);

    if (!est) {
      return c.json(
        { data: null, error: { code: 'NOT_FOUND', message: 'Estimator not found.' } },
        404,
      );
    }

    // Iframe embed — works reliably on every platform (WordPress, GoHighLevel, Wix,
    // …) because it isn't affected by page-builder script sandboxing. The estimator
    // renders full-width inside the iframe (its own shell caps + centers itself).
    const widgetUrl = env.CORS_WIDGET_ORIGINS.split(',')[0] ?? 'http://localhost:5173';
    const snippet = [
      `<!-- Estimator Widget: ${est.title} -->`,
      `<iframe`,
      `  src="${widgetUrl}/embed-example.html?key=${est.publicKey}"`,
      `  style="width:100%; height:min(880px,90vh); min-height:560px; border:none; border-radius:16px;"`,
      `  title="${est.title}"`,
      `  loading="lazy"></iframe>`,
    ].join('\n');

    return c.json({ data: { snippet, publicKey: est.publicKey }, error: null });
  });

  // ── GET /:id/pricing — get current pricing config ────────────────────────
  app.get('/:id/pricing', requireAuth, async (c) => {
    const auth = c.get('auth');
    const [est] = await db
      .select()
      .from(estimators)
      .where(and(eq(estimators.id, c.req.param('id')), eq(estimators.tenantId, auth.tenantId)))
      .limit(1);

    if (!est) {
      return c.json(
        { data: null, error: { code: 'NOT_FOUND', message: 'Estimator not found.' } },
        404,
      );
    }

    const result = await pricingService.getConfig(auth.tenantId, est.id);
    if (!result.ok) {
      return c.json({ data: null, error: result.error }, 404);
    }
    return c.json({ data: result.value, error: null });
  });

  // ── PUT /:id/pricing — save / replace pricing config ────────────────────
  app.put('/:id/pricing', requireAuth, auditLog(audit, 'estimator.update_pricing', 'estimator'), async (c) => {
    const auth = c.get('auth');
    const [est] = await db
      .select()
      .from(estimators)
      .where(and(eq(estimators.id, c.req.param('id')), eq(estimators.tenantId, auth.tenantId)))
      .limit(1);

    if (!est) {
      return c.json(
        { data: null, error: { code: 'NOT_FOUND', message: 'Estimator not found.' } },
        404,
      );
    }

    const body = await c.req.json();
    const parsed = pricingConfigSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { data: null, error: { code: 'VALIDATION', message: parsed.error.message } },
        400,
      );
    }

    const result = await pricingService.upsert(auth.tenantId, est.id, parsed.data);
    if (!result.ok) {
      return c.json({ data: null, error: result.error }, 500);
    }
    return c.json({ data: { id: result.value.id, config: parsed.data }, error: null });
  });

  return app;
}

// ── Default export: wired to real DB ─────────────────────────────────────────

export const estimatorRoutes = createEstimatorRoutes(realDb, undefined, new AuditService(realDb));
