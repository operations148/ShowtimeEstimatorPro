import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import * as jose from 'jose';
import { env } from '../env';
import { SESSION_COOKIE_NAME } from '@repo/shared';

export interface AuthContext {
  userId: string;
  tenantId: string;
  role: string;
}

/**
 * Middleware that verifies the session cookie JWT and injects auth context.
 */
export const requireAuth = createMiddleware<{ Variables: { auth: AuthContext } }>(
  async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE_NAME);
    if (!token) {
      return c.json(
        { data: null, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        401,
      );
    }

    try {
      const secret = new TextEncoder().encode(env.SESSION_SECRET);
      const { payload } = await jose.jwtVerify(token, secret);
      c.set('auth', {
        userId: payload.sub as string,
        tenantId: payload.tenantId as string,
        role: payload.role as string,
      });
      await next();
    } catch {
      return c.json(
        { data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired session' } },
        401,
      );
    }
  },
);

/**
 * Middleware that restricts access to specific roles.
 */
export function requireRole(...roles: string[]) {
  return createMiddleware<{ Variables: { auth: AuthContext } }>(async (c, next) => {
    const auth = c.get('auth');
    if (!auth || !roles.includes(auth.role)) {
      return c.json(
        { data: null, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } },
        403,
      );
    }
    await next();
  });
}
