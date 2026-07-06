import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { requestId } from 'hono/request-id';
import { serveStatic } from '@hono/node-server/serve-static';
import { env } from './env';
import { logger } from './lib/logger';
import { authRoutes } from './routes/auth';
import { estimatorRoutes } from './routes/estimators';
import { submissionRoutes } from './routes/submissions';
import { widgetRoutes } from './routes/widget';
import { analyticsRoutes } from './routes/analytics';
import { billingRoutes } from './routes/billing';
import { exportRoutes } from './routes/exports';
import { tenantRoutes } from './routes/tenants';
import { integrationRoutes } from './routes/integrations';
import { userRoutes } from './routes/users';
import { serviceAreaRoutes } from './routes/service-areas';
import { healthRoutes } from './routes/health';
import { auditLogRoutes } from './routes/audit-logs';
import { devRoutes } from './routes/dev';
import { mediaRoutes } from './routes/media';
import { errorHandler } from './middleware/error-handler';
import { csrf } from './middleware/csrf';

export const app = new Hono();

// ── Global middleware ──
app.use('*', requestId());

// Pino request logger — creates a per-request child logger with the requestId
// bound to every log line emitted within that request's lifecycle.
app.use('*', async (c, next) => {
  const start = Date.now();
  const requestId = c.get('requestId') as string;
  const reqLogger = logger.child({ requestId });
  c.set('logger', reqLogger);

  await next();

  // Skip logging for health checks to avoid log noise in monitoring systems
  if (c.req.path !== '/api/v1/health') {
    reqLogger.info(
      {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        ms: Date.now() - start,
      },
      'http',
    );
  }
});

// ── Content-Security-Policy on all responses ──────────────────────────────────
// This is an API server; the CSP is defensive (no HTML rendered).
app.use('*', async (c, next) => {
  await next();
  c.res.headers.set(
    'Content-Security-Policy',
    "default-src 'none'; frame-ancestors 'none'",
  );
});

// ── CORS ──────────────────────────────────────────────────────────────────────
// Three distinct policies:
//   1. Billing webhook (/api/v1/billing/webhook) — no CORS (Stripe calls server-to-server)
//   2. Public widget paths — allow configured widget origins, no credentials
//   3. Dashboard routes — allow dashboard origin only, credentials required
const widgetOrigins = env.CORS_WIDGET_ORIGINS.split(',').map((o) => o.trim());

// Public widget paths: submissions POST, analytics events POST, widget GET
const widgetCorsMw = cors({
  origin: widgetOrigins,
  credentials: false,
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
});
app.use('/api/v1/widget/*', widgetCorsMw);
// Apply widget CORS only to POST /submissions (the public widget submit endpoint).
// GET /submissions is dashboard-only (authenticated) and must use dashboard CORS.
app.use('/api/v1/submissions', async (c, next) => {
  if (c.req.method === 'POST') {
    return widgetCorsMw(c, next);
  }
  if (c.req.method === 'OPTIONS') {
    // Route preflight to widget CORS only if the actual request will be a POST (widget submit).
    // GET/DELETE preflights come from the dashboard and must use dashboard CORS.
    const requestedMethod = c.req.header('Access-Control-Request-Method') ?? '';
    if (requestedMethod === 'POST') {
      return widgetCorsMw(c, next);
    }
    return next();
  }
  return next();
});
app.use('/api/v1/analytics/events', widgetCorsMw);

// Dashboard CORS for all other /api/v1/* routes (billing/webhook is excluded below)
app.use('/api/v1/*', async (c, next) => {
  // Billing webhook: no CORS headers — called by payment provider, not a browser
  if (c.req.path === '/api/v1/billing/webhook') {
    return next();
  }
  return cors({
    origin: [env.CORS_DASHBOARD_ORIGIN],
    credentials: true,
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
  })(c, next);
});

// ── CSRF protection for dashboard state-mutating routes ───────────────────────
// Excluded from CSRF:
//   - Safe methods (GET, HEAD, OPTIONS) — handled inside the middleware
//   - /auth/otp/* — pre-auth, no session cookie yet
//   - /submissions — public widget endpoint, no cookie
//   - /analytics/events — public widget endpoint, no cookie
//   - /billing/webhook — Stripe server-to-server call
app.use('/api/v1/*', async (c, next) => {
  const path = c.req.path;
  const bypassPaths = [
    '/api/v1/tenants/signup',
    '/api/v1/auth/otp/request',
    '/api/v1/auth/otp/verify',
    '/api/v1/auth/csrf-token',
    // Google OAuth — callback is a GET (safe), setup is pre-auth (no session yet)
    '/api/v1/auth/google/setup',
    '/api/v1/submissions',
    '/api/v1/analytics/events',
    '/api/v1/billing/webhook',
  ];
  // Dev-only routes never carry session cookies — CSRF protection is irrelevant
  if (path.startsWith('/api/v1/dev/')) {
    return next();
  }
  if (bypassPaths.includes(path)) {
    return next();
  }
  return csrf(c, next);
});

// ── Error handler ──
app.onError(errorHandler);

// ── Routes ──
app.route('/api/v1/health', healthRoutes);
app.route('/api/v1/auth', authRoutes);
app.route('/api/v1/tenants', tenantRoutes);
app.route('/api/v1/integrations', integrationRoutes);
app.route('/api/v1/users', userRoutes);
app.route('/api/v1/service-areas', serviceAreaRoutes);
app.route('/api/v1/estimators', estimatorRoutes);
app.route('/api/v1/submissions', submissionRoutes);
app.route('/api/v1/widget', widgetRoutes);
app.route('/api/v1/analytics', analyticsRoutes);
app.route('/api/v1/billing', billingRoutes);
app.route('/api/v1/exports', exportRoutes);
app.route('/api/v1/audit-logs', auditLogRoutes);
app.route('/api/v1/media', mediaRoutes);

// ── Dev-only routes (never mounted in production) ──
if (env.NODE_ENV !== 'production') {
  app.route('/api/v1/dev', devRoutes);
}

// ── Static uploads (images uploaded via /media/upload) ──
app.use('/uploads/*', cors({ origin: '*', credentials: false }));
app.use('/uploads/*', serveStatic({ root: './public' }));

// ── 404 ──
app.notFound((c) =>
  c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404),
);
