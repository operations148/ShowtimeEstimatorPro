import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { eq, and } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { estimators, estimatorVersions, tenants } from '../models/schema';
import type * as schema from '../models/schema';
import { db as realDb } from '../models/db';

// Default lead field configuration — which fields the widget collects from the end-user.
// Name, phone, and email are required; zip is optional and only used for
// service-area gating when the lead chooses to provide it.
const DEFAULT_LEAD_CONFIG = {
  required: ['name', 'phone', 'email'],
  optional: ['zip'],
} as const;

export function createWidgetRoutes(db: NodePgDatabase<typeof schema>): Hono {
  const app = new Hono();

  /**
   * GET /:publicKey
   * Public endpoint: returns the full widget config needed to render the estimator.
   *
   * Only published estimators are returned. Draft estimators return 404 so they
   * cannot be previewed through the production widget path.
   */
  app.get('/:publicKey', async (c) => {
    const publicKey = c.req.param('publicKey');

    const [est] = await db
      .select()
      .from(estimators)
      .where(and(eq(estimators.publicKey, publicKey), eq(estimators.status, 'published')))
      .limit(1);

    if (!est) {
      return c.json(
        {
          data: null,
          error: { code: 'NOT_FOUND', message: 'Estimator not found or not published.' },
        },
        404,
      );
    }

    // Fetch current version with questions
    const questions = est.currentVersionId
      ? (
          await db
            .select()
            .from(estimatorVersions)
            .where(eq(estimatorVersions.id, est.currentVersionId))
            .limit(1)
        )[0]?.questions ?? []
      : [];

    // Fetch tenant for service area policy, display name, and org branding
    const [tenant] = await db
      .select({
        name: tenants.name,
        serviceAreaBehavior: tenants.serviceAreaBehavior,
        branding: tenants.branding,
      })
      .from(tenants)
      .where(eq(tenants.id, est.tenantId))
      .limit(1);

    // Merge branding: per-estimator branding wins, falling back to the tenant's
    // org-level branding (logo/color/font set once in the dashboard).
    const estBranding = est.branding ?? {};
    const tenantBranding = tenant?.branding ?? {};
    const branding = {
      logoUrl: estBranding.logoUrl ?? tenantBranding.logoUrl,
      primaryColor: estBranding.primaryColor ?? tenantBranding.primaryColor,
      fontFamily: estBranding.fontFamily ?? tenantBranding.fontFamily,
      bookingUrl: estBranding.bookingUrl ?? tenantBranding.bookingUrl,
    };

    return c.json({
      data: {
        estimatorId: est.id,
        publicKey: est.publicKey,
        title: est.title,
        branding,
        questions,
        tenantName: tenant?.name ?? '',
        serviceAreaBehavior: tenant?.serviceAreaBehavior ?? 'block',
        leadConfig: DEFAULT_LEAD_CONFIG,
      },
      error: null,
    });
  });

  return app;
}

// ── Default export: wired to real DB + per-route CORS ────────────────────────
// Widget routes are public and embedded on third-party sites, so they get a
// separate permissive CORS policy (no credentials, accepts all configured origins).

export const widgetRoutes = new Hono();

// The widget config is fetched from arbitrary customer sites where the widget is
// embedded, so allow any origin (public, read-only, no credentials).
widgetRoutes.use(
  '*',
  cors({
    origin: '*',
    credentials: false,
    allowMethods: ['GET', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
  }),
);

widgetRoutes.route('/', createWidgetRoutes(realDb));
