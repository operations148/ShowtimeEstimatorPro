import { createMiddleware } from 'hono/factory';
import type { AuditService } from '../services/audit.service';
import type { AuthContext } from './auth';

/**
 * Per-route audit middleware factory.
 *
 * Usage:
 *   app.post('/', requireAuth, auditLog(svc, 'user.create', 'user'), handler);
 *
 * After the downstream handler runs:
 *   - Skips logging if the response is not 2xx (error / validation / not-found paths).
 *   - Skips logging if there is no auth context (public endpoints).
 *   - Extracts resourceId from the URL path param :id when available, otherwise
 *     attempts to read `data.id` or `data.submissionId` from the JSON response body.
 *   - Extracts the client IP from x-forwarded-for (first value) and the user-agent
 *     header. Both are optional.
 *   - Never throws — audit failures must not disrupt the primary request.
 */
export function auditLog(auditService: AuditService, action: string, resourceType: string) {
  return createMiddleware<{ Variables: { auth: AuthContext } }>(async (c, next) => {
    await next();

    // Only log when the handler succeeded.
    const status = c.res?.status ?? 0;
    if (status < 200 || status >= 300) return;

    const auth = c.get('auth');
    if (!auth) return; // unauthenticated route — nothing to log

    // ── Resource ID ────────────────────────────────────────────────────────────
    // URL path param covers PATCH /:id, DELETE /:id, POST /:id/publish, etc.
    // Response body covers POST / (create) which returns the new resource's id.
    let resourceId: string = '';
    try {
      resourceId = c.req.param('id') ?? '';
    } catch {
      /* param not defined for this route shape */
    }

    if (!resourceId && c.res) {
      try {
        const clone = c.res.clone();
        const json = (await clone.json()) as Record<string, unknown>;
        const data = json?.data as Record<string, unknown> | null;
        resourceId =
          (data?.id as string | undefined) ??
          (data?.submissionId as string | undefined) ??
          '';
      } catch {
        /* response body not parseable as JSON (e.g. CSV export) */
      }
    }

    // ── Network metadata ───────────────────────────────────────────────────────
    const forwarded = c.req.header('x-forwarded-for');
    const ipAddress = forwarded ? forwarded.split(',')[0]!.trim() : undefined;
    const userAgent = c.req.header('user-agent');

    auditService.logAction({
      tenantId: auth.tenantId,
      actorId: auth.userId,
      action,
      resourceType,
      resourceId: resourceId || 'unknown',
      ipAddress,
      userAgent,
    });
  });
}
