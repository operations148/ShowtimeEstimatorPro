import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';

const CSRF_COOKIE = 'csrf_token';
const CSRF_HEADER = 'X-CSRF-Token';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Double-submit cookie CSRF protection.
 *
 * The client must:
 *   1. Fetch GET /api/v1/auth/csrf-token to receive a token in a non-httpOnly cookie.
 *   2. Echo that token back in the X-CSRF-Token header on every state-mutating request.
 *
 * This middleware rejects requests where the header is missing or doesn't match the cookie.
 */
export const csrf = createMiddleware(async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) {
    return next();
  }

  const cookieToken = getCookie(c, CSRF_COOKIE);
  const headerToken = c.req.header(CSRF_HEADER);

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return c.json(
      { data: null, error: { code: 'CSRF_VIOLATION', message: 'CSRF token mismatch.' } },
      403,
    );
  }

  return next();
});
