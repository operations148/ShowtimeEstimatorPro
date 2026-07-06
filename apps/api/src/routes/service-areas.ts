import { Hono } from 'hono';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../models/schema';
import { ServiceAreaService } from '../services/service-area.service';
import { requireAuth } from '../middleware/auth';
import { auditLog } from '../middleware/audit';
import { AuditService } from '../services/audit.service';
import { db as realDb } from '../models/db';

export function createServiceAreaRoutes(
  db: BetterSQLite3Database<typeof schema>,
  auditService?: AuditService,
): Hono {
  const service = new ServiceAreaService(db);
  const audit = auditService ?? new AuditService(db);
  const app = new Hono();

  // GET / — list all configured zips for the tenant
  app.get('/', requireAuth, (c) => {
    const auth = c.get('auth');
    const zips = service.listZips(auth.tenantId);
    return c.json({ data: { zips, count: zips.length }, error: null });
  });

  // POST /import — accept CSV file upload, parse zips, replace existing
  app.post('/import', requireAuth, auditLog(audit, 'service_area.import', 'service_area'), async (c) => {
    const auth = c.get('auth');

    let csvText: string;

    const contentType = c.req.header('content-type') ?? '';

    if (contentType.includes('multipart/form-data')) {
      // File upload via multipart form
      const body = await c.req.parseBody();
      const file = body['file'];

      if (!file || typeof file === 'string') {
        return c.json(
          { data: null, error: { code: 'VALIDATION', message: 'Missing file field in form data.' } },
          400,
        );
      }

      csvText = await (file as File).text();
    } else if (contentType.includes('text/csv') || contentType.includes('text/plain')) {
      // Raw CSV body
      csvText = await c.req.text();
    } else {
      return c.json(
        {
          data: null,
          error: {
            code: 'VALIDATION',
            message: 'Expected multipart/form-data with a "file" field, or a raw text/csv body.',
          },
        },
        400,
      );
    }

    const zips = parseCsvZips(csvText);
    const result = service.importZips(auth.tenantId, zips);

    if (!result.ok) {
      return c.json({ data: null, error: result.error }, 422);
    }

    return c.json({ data: result.value, error: null });
  });

  // DELETE / — clear all zips (tenant reverts to "open to all")
  app.delete('/', requireAuth, auditLog(audit, 'service_area.clear', 'service_area'), (c) => {
    const auth = c.get('auth');
    service.clearZips(auth.tenantId);
    return c.json({ data: { cleared: true }, error: null });
  });

  return app;
}

/**
 * Parse a CSV that has an optional "zip" header row followed by one zip per line.
 * Handles CRLF and LF line endings. Blank lines are ignored.
 */
export function parseCsvZips(csv: string): string[] {
  return csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.toLowerCase() !== 'zip');
}

// ── Default export: wired to real DB ─────────────────────────────────────────

export const serviceAreaRoutes = createServiceAreaRoutes(realDb, new AuditService(realDb));
