import { Hono } from 'hono';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { ExportService } from '../services/export.service';
import { requireAuth } from '../middleware/auth';
import { createSubscriptionEnforcement } from '../middleware/subscription';
import { auditLog } from '../middleware/audit';
import { AuditService } from '../services/audit.service';
import { db as realDb } from '../models/db';
import type * as schema from '../models/schema';

export function createExportRoutes(
  db: NodePgDatabase<typeof schema>,
  auditService?: AuditService,
): Hono {
  const app = new Hono();
  const exportService = new ExportService(db);
  const audit = auditService ?? new AuditService(db);

  // Auth + subscription enforcement applied globally for all export routes.
  app.use('*', requireAuth);
  app.use('*', createSubscriptionEnforcement(db));

  app.get('/submissions', requireAuth, auditLog(audit, 'export.download', 'export'), async (c) => {
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

    const result = await exportService.exportSubmissions(auth.tenantId, {
      estimatorId: estimatorId ?? undefined,
      from,
      to,
    });

    if (!result.ok) {
      return c.json({ data: null, error: result.error }, 422);
    }

    const filename = `submissions-${new Date().toISOString().slice(0, 10)}.csv`;
    return new Response(result.value, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  });

  return app;
}

export const exportRoutes = createExportRoutes(realDb, new AuditService(realDb));
