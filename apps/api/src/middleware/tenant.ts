import { createMiddleware } from 'hono/factory';
import type { AuthContext } from './auth';

/**
 * Ensures tenant_id is always available in the request context
 * after auth middleware has run.
 */
export const resolveTenant = createMiddleware<{ Variables: { auth: AuthContext } }>(
  async (c, next) => {
    const auth = c.get('auth');
    if (!auth?.tenantId) {
      return c.json(
        { data: null, error: { code: 'BAD_REQUEST', message: 'Tenant context missing' } },
        400,
      );
    }
    await next();
  },
);
