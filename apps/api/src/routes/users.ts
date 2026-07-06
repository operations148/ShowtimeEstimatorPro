import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { users } from '../models/schema';
import type * as schema from '../models/schema';
import { createUserSchema, updateUserRoleSchema } from '@repo/shared';
import { requireAuth, requireRole } from '../middleware/auth';
import { createSubscriptionEnforcement } from '../middleware/subscription';
import { auditLog } from '../middleware/audit';
import { AuditService } from '../services/audit.service';
import { db as realDb } from '../models/db';

export function createUserRoutes(
  db: BetterSQLite3Database<typeof schema>,
  auditService?: AuditService,
): Hono {
  const audit = auditService ?? new AuditService(db);
  const app = new Hono();

  // Auth + subscription enforcement applied globally for all user routes.
  app.use('*', requireAuth);
  app.use('*', createSubscriptionEnforcement(db));

  // GET / — list users in the caller's tenant
  app.get('/', requireAuth, async (c) => {
    const auth = c.get('auth');
    const rows = db.select().from(users).where(eq(users.tenantId, auth.tenantId)).all();
    return c.json({ data: rows, error: null });
  });

  // POST / — invite/create a user (owner/admin only)
  app.post('/', requireAuth, requireRole('owner', 'admin'), auditLog(audit, 'user.create', 'user'), async (c) => {
    const auth = c.get('auth');
    const body = await c.req.json();
    const parsed = createUserSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { data: null, error: { code: 'VALIDATION', message: parsed.error.message } },
        400,
      );
    }

    const [user] = db
      .insert(users)
      .values({ ...parsed.data, tenantId: auth.tenantId })
      .returning()
      .all();

    return c.json({ data: user, error: null }, 201);
  });

  // PATCH /:id — update role (owner only; can't change your own role)
  app.patch('/:id', requireAuth, requireRole('owner'), auditLog(audit, 'user.update', 'user'), async (c) => {
    const auth = c.get('auth');
    const userId = c.req.param('id');

    if (userId === auth.userId) {
      return c.json(
        { data: null, error: { code: 'FORBIDDEN', message: 'Cannot change your own role.' } },
        403,
      );
    }

    const body = await c.req.json();
    const parsed = updateUserRoleSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { data: null, error: { code: 'VALIDATION', message: parsed.error.message } },
        400,
      );
    }

    const [existing] = db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), eq(users.tenantId, auth.tenantId)))
      .limit(1)
      .all();

    if (!existing) {
      return c.json(
        { data: null, error: { code: 'NOT_FOUND', message: 'User not found.' } },
        404,
      );
    }

    const [updated] = db
      .update(users)
      .set({ role: parsed.data.role, updatedAt: new Date() })
      .where(and(eq(users.id, userId), eq(users.tenantId, auth.tenantId)))
      .returning()
      .all();

    return c.json({ data: updated, error: null });
  });

  // DELETE /:id — remove user (owner only; can't delete yourself)
  app.delete('/:id', requireAuth, requireRole('owner'), auditLog(audit, 'user.delete', 'user'), async (c) => {
    const auth = c.get('auth');
    const userId = c.req.param('id');

    if (userId === auth.userId) {
      return c.json(
        { data: null, error: { code: 'FORBIDDEN', message: 'Cannot delete yourself.' } },
        403,
      );
    }

    const [existing] = db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), eq(users.tenantId, auth.tenantId)))
      .limit(1)
      .all();

    if (!existing) {
      return c.json(
        { data: null, error: { code: 'NOT_FOUND', message: 'User not found.' } },
        404,
      );
    }

    db.delete(users)
      .where(and(eq(users.id, userId), eq(users.tenantId, auth.tenantId)))
      .run();

    return c.json({ data: { deleted: true }, error: null });
  });

  return app;
}

// ── Default export: wired to real DB ─────────────────────────────────────────

export const userRoutes = createUserRoutes(realDb, new AuditService(realDb));
