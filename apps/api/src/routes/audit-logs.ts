import { Hono } from 'hono';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { AuditService } from '../services/audit.service';
import { requireAuth, requireRole } from '../middleware/auth';
import { db as realDb } from '../models/db';
import type * as schema from '../models/schema';
import { PAGINATION_DEFAULT_LIMIT, PAGINATION_MAX_LIMIT } from '@repo/shared';

export function createAuditLogRoutes(db: NodePgDatabase<typeof schema>): Hono {
  const app = new Hono();
  const auditService = new AuditService(db);

  /**
   * GET / — list audit logs for the caller's tenant.
   * Restricted to owner and admin roles.
   *
   * Query params:
   *   actorId      — filter by actor (user) ID
   *   action       — filter by action string (exact match)
   *   resourceType — filter by resource type (exact match)
   *   from         — ISO date lower bound on timestamp (inclusive)
   *   to           — ISO date upper bound on timestamp (inclusive)
   *   limit        — page size (default 25, max 100)
   *   offset       — page offset (default 0)
   */
  app.get('/', requireAuth, requireRole('owner', 'admin'), async (c) => {
    const auth = c.get('auth');

    const actorId = c.req.query('actorId');
    const action = c.req.query('action');
    const resourceType = c.req.query('resourceType');
    const fromParam = c.req.query('from');
    const toParam = c.req.query('to');
    const limitParam = c.req.query('limit');
    const offsetParam = c.req.query('offset');

    // Validate date params
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

    // Parse and clamp pagination params
    const limit = Math.min(
      Math.max(1, parseInt(limitParam ?? String(PAGINATION_DEFAULT_LIMIT), 10) || PAGINATION_DEFAULT_LIMIT),
      PAGINATION_MAX_LIMIT,
    );
    const offset = Math.max(0, parseInt(offsetParam ?? '0', 10) || 0);

    const result = await auditService.queryLogs(auth.tenantId, {
      actorId: actorId ?? undefined,
      action: action ?? undefined,
      resourceType: resourceType ?? undefined,
      from,
      to,
      limit,
      offset,
    });

    return c.json({
      data: result.logs,
      meta: { total: result.total, limit: result.limit, offset: result.offset },
      error: null,
    });
  });

  // Audit logs are append-only — no POST, PUT, PATCH, or DELETE endpoints.

  return app;
}

export const auditLogRoutes = createAuditLogRoutes(realDb);
