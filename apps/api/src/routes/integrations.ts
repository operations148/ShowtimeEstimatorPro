import { Hono } from 'hono';
import { setCookie, getCookie } from 'hono/cookie';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { tenants } from '../models/schema';
import type * as schema from '../models/schema';
import type { TenantIntegrations } from '@repo/shared';
import { updateIntegrationsSchema } from '@repo/shared';
import { requireAuth, requireRole } from '../middleware/auth';
import { db as realDb } from '../models/db';
import { env } from '../env';
import { logger } from '../lib/logger';
import { IntegrationDispatchService } from '../services/integration.service';

const GOOGLE_SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets openid email';
const STATE_COOKIE = 'gsheets_oauth_state';

function sheetsRedirectUri(): string {
  return (
    env.GOOGLE_SHEETS_REDIRECT_URI ??
    `http://localhost:${env.PORT}/api/v1/integrations/google-sheets/callback`
  );
}

/** Public (client-safe) view of a tenant's integration config — secrets stripped. */
function redactIntegrations(integrations: TenantIntegrations | null | undefined) {
  const i = integrations ?? {};
  return {
    ghl: i.ghl ?? { enabled: false, webhookUrl: '' },
    sheetsWebhook: i.sheetsWebhook ?? { enabled: false, webhookUrl: '' },
    googleSheets: {
      enabled: i.googleSheets?.enabled ?? false,
      spreadsheetId: i.googleSheets?.spreadsheetId ?? '',
      sheetName: i.googleSheets?.sheetName ?? '',
      connected: !!i.googleSheets?.refreshToken,
      connectedEmail: i.googleSheets?.connectedEmail ?? '',
    },
  };
}

export function createIntegrationRoutes(db: NodePgDatabase<typeof schema>): Hono {
  const app = new Hono();
  const dispatch = new IntegrationDispatchService();

  const loadTenant = async (tenantId: string) =>
    (await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1))[0];

  // GET / — current integration config (secrets redacted)
  app.get('/', requireAuth, requireRole('owner', 'admin'), async (c) => {
    const auth = c.get('auth');
    const tenant = await loadTenant(auth.tenantId);
    if (!tenant) {
      return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Tenant not found.' } }, 404);
    }
    return c.json({ data: redactIntegrations(tenant.integrations), error: null });
  });

  // PUT / — update webhook targets + Google Sheets client fields (tokens preserved)
  app.put('/', requireAuth, requireRole('owner', 'admin'), async (c) => {
    const auth = c.get('auth');
    const body = await c.req.json();
    const parsed = updateIntegrationsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ data: null, error: { code: 'VALIDATION', message: parsed.error.message } }, 400);
    }

    const tenant = await loadTenant(auth.tenantId);
    if (!tenant) {
      return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Tenant not found.' } }, 404);
    }

    const current: TenantIntegrations = tenant.integrations ?? {};
    const p = parsed.data;
    const next: TenantIntegrations = {
      ...current,
      ...(p.ghl !== undefined
        ? { ghl: { enabled: p.ghl.enabled, webhookUrl: p.ghl.webhookUrl.trim() } }
        : {}),
      ...(p.sheetsWebhook !== undefined
        ? { sheetsWebhook: { enabled: p.sheetsWebhook.enabled, webhookUrl: p.sheetsWebhook.webhookUrl.trim() } }
        : {}),
      // Merge client-settable Google Sheets fields but never touch the stored tokens.
      ...(p.googleSheets !== undefined
        ? {
            googleSheets: {
              ...current.googleSheets,
              enabled: p.googleSheets.enabled,
              spreadsheetId: extractSpreadsheetId(p.googleSheets.spreadsheetId),
              sheetName: p.googleSheets.sheetName?.trim() ?? current.googleSheets?.sheetName,
            },
          }
        : {}),
    };

    await db.update(tenants).set({ integrations: next, updatedAt: new Date() }).where(eq(tenants.id, auth.tenantId));
    return c.json({ data: redactIntegrations(next), error: null });
  });

  // POST /test — dispatch a sample lead to whatever is currently enabled
  app.post('/test', requireAuth, requireRole('owner', 'admin'), async (c) => {
    const auth = c.get('auth');
    const tenant = await loadTenant(auth.tenantId);
    if (!tenant) {
      return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Tenant not found.' } }, 404);
    }
    const integrations = tenant.integrations ?? {};
    const targets: string[] = [];
    if (integrations.ghl?.enabled) targets.push('ghl');
    if (integrations.sheetsWebhook?.enabled) targets.push('sheetsWebhook');
    if (integrations.googleSheets?.enabled && integrations.googleSheets.refreshToken) targets.push('googleSheets');

    await dispatch.dispatchNewLead(integrations, {
      submissionId: `test-${randomUUID().slice(0, 8)}`,
      name: 'Test Lead',
      phone: '(555) 555-0100',
      email: 'test-lead@example.com',
      zip: '90210',
      estimatorTitle: 'Test Estimator',
      estimateMin: 25000,
      estimateMax: 45000,
      currency: 'USD',
      answers: { note: 'This is a test dispatch from EstimatorPro.' },
      submittedAt: new Date(),
    });

    return c.json({ data: { dispatched: true, targets }, error: null });
  });

  // ── Native Google Sheets OAuth ─────────────────────────────────────────────

  // GET /google-sheets/connect — begin OAuth (offline access for a refresh token)
  app.get('/google-sheets/connect', requireAuth, requireRole('owner', 'admin'), (c) => {
    if (!env.GOOGLE_CLIENT_ID) {
      return c.json(
        { data: null, error: { code: 'NOT_CONFIGURED', message: 'Google integration is not configured.' } },
        501,
      );
    }
    const state = randomUUID();
    setCookie(c, STATE_COOKIE, state, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'Lax',
      path: '/',
      maxAge: 300,
    });
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: sheetsRedirectUri(),
      response_type: 'code',
      scope: GOOGLE_SHEETS_SCOPE,
      access_type: 'offline',
      prompt: 'consent', // force a refresh_token even on repeat connects
      state,
    });
    return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  });

  // GET /google-sheets/callback — exchange code, store refresh token + email
  app.get('/google-sheets/callback', requireAuth, requireRole('owner', 'admin'), async (c) => {
    const auth = c.get('auth');
    const settingsUrl = `${env.CORS_DASHBOARD_ORIGIN}/settings/integrations`;
    const { code, state, error: oauthError } = c.req.query();
    const storedState = getCookie(c, STATE_COOKIE);
    setCookie(c, STATE_COOKIE, '', { maxAge: 0, path: '/' });

    if (oauthError || !code || !state || state !== storedState) {
      return c.redirect(`${settingsUrl}?gsheets_error=oauth_failed`);
    }

    // Exchange the auth code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID!,
        client_secret: env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: sheetsRedirectUri(),
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) {
      return c.redirect(`${settingsUrl}?gsheets_error=token_exchange`);
    }
    const tokenData = (await tokenRes.json()) as { access_token?: string; refresh_token?: string };
    if (!tokenData.refresh_token) {
      // Google only returns a refresh token on first consent; prompt=consent should
      // force one, but guard anyway so we never store a half-connected state.
      return c.redirect(`${settingsUrl}?gsheets_error=no_refresh_token`);
    }

    // Best-effort: fetch the connected account email for display
    let connectedEmail = '';
    try {
      const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      if (infoRes.ok) {
        connectedEmail = ((await infoRes.json()) as { email?: string }).email ?? '';
      }
    } catch (err) {
      logger.warn({ err }, 'Google Sheets connect: userinfo fetch failed');
    }

    const tenant = await loadTenant(auth.tenantId);
    const current: TenantIntegrations = tenant?.integrations ?? {};
    const next: TenantIntegrations = {
      ...current,
      googleSheets: {
        enabled: current.googleSheets?.enabled ?? true,
        spreadsheetId: current.googleSheets?.spreadsheetId,
        sheetName: current.googleSheets?.sheetName,
        refreshToken: tokenData.refresh_token,
        connectedEmail,
      },
    };
    await db.update(tenants).set({ integrations: next, updatedAt: new Date() }).where(eq(tenants.id, auth.tenantId));

    return c.redirect(`${settingsUrl}?gsheets_connected=1`);
  });

  // POST /google-sheets/disconnect — clear stored tokens
  app.post('/google-sheets/disconnect', requireAuth, requireRole('owner', 'admin'), async (c) => {
    const auth = c.get('auth');
    const tenant = await loadTenant(auth.tenantId);
    if (!tenant) {
      return c.json({ data: null, error: { code: 'NOT_FOUND', message: 'Tenant not found.' } }, 404);
    }
    const current: TenantIntegrations = tenant.integrations ?? {};
    const next: TenantIntegrations = { ...current, googleSheets: { enabled: false } };
    await db.update(tenants).set({ integrations: next, updatedAt: new Date() }).where(eq(tenants.id, auth.tenantId));
    return c.json({ data: redactIntegrations(next), error: null });
  });

  return app;
}

/**
 * Accepts either a raw spreadsheet ID or a full Google Sheets URL and returns
 * the bare ID (…/spreadsheets/d/<ID>/edit → <ID>).
 */
function extractSpreadsheetId(input: string | undefined): string | undefined {
  if (!input) return input;
  const trimmed = input.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : trimmed;
}

export const integrationRoutes = createIntegrationRoutes(realDb);
