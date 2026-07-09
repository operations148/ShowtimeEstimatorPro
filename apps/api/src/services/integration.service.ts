import type { TenantIntegrations } from '@repo/shared';
import { env } from '../env';
import { logger } from '../lib/logger';

/**
 * Normalized new-lead payload sent to CRM integrations.
 */
export interface LeadDispatchPayload {
  submissionId: string;
  name?: string | null;
  phone?: string | null;
  email: string;
  zip?: string | null;
  estimatorTitle: string;
  estimateMin: number;
  estimateMax: number;
  currency: string;
  answers: Record<string, unknown>;
  submittedAt: Date;
}

const REQUEST_TIMEOUT_MS = 8000;

/** Per-target dispatch outcome, surfaced by the "Send test lead" diagnostic. */
export interface DispatchResult {
  target: 'ghl' | 'sheetsWebhook' | 'googleSheets';
  ok: boolean;
  detail: string;
}

/**
 * Dispatches new leads to a tenant's configured CRM integrations.
 *
 * Each target catches its own errors and returns a result so one failing
 * integration never blocks the others or the submission response. Called from
 * the submissions handler after a lead is persisted, and from the /test route.
 */
export class IntegrationDispatchService {
  async dispatchNewLead(
    integrations: TenantIntegrations,
    payload: LeadDispatchPayload,
  ): Promise<DispatchResult[]> {
    const tasks: Promise<DispatchResult>[] = [];

    if (integrations.ghl?.enabled && isHttpUrl(integrations.ghl.webhookUrl)) {
      tasks.push(this.postWebhook('ghl', integrations.ghl.webhookUrl, this.toJson(payload)));
    }

    if (integrations.sheetsWebhook?.enabled && isHttpUrl(integrations.sheetsWebhook.webhookUrl)) {
      tasks.push(
        this.postWebhook('sheetsWebhook', integrations.sheetsWebhook.webhookUrl, this.toJson(payload)),
      );
    }

    const gs = integrations.googleSheets;
    if (gs?.enabled && gs.refreshToken && gs.spreadsheetId) {
      tasks.push(this.appendToGoogleSheet(gs, payload));
    }

    return Promise.all(tasks);
  }

  /** Flat JSON body for webhook targets (GHL, Apps Script / Zapier). */
  private toJson(p: LeadDispatchPayload) {
    return {
      submissionId: p.submissionId,
      name: p.name ?? '',
      phone: p.phone ?? '',
      email: p.email,
      zip: p.zip ?? '',
      estimatorTitle: p.estimatorTitle,
      estimateMin: p.estimateMin,
      estimateMax: p.estimateMax,
      currency: p.currency,
      estimateRange: `${formatCurrency(p.estimateMin, p.currency)} – ${formatCurrency(p.estimateMax, p.currency)}`,
      answers: p.answers,
      submittedAt: p.submittedAt.toISOString(),
    };
  }

  private async postWebhook(
    target: DispatchResult['target'],
    url: string,
    body: unknown,
  ): Promise<DispatchResult> {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        logger.warn({ status: res.status, target }, 'Integration webhook returned non-2xx');
        return { target, ok: false, detail: `Webhook returned HTTP ${res.status}` };
      }
      return { target, ok: true, detail: 'Sent' };
    } catch (err) {
      const detail = (err as Error)?.message ?? 'request failed';
      logger.error({ err, target }, 'Integration webhook POST failed');
      return { target, ok: false, detail };
    }
  }

  private async appendToGoogleSheet(
    cfg: NonNullable<TenantIntegrations['googleSheets']>,
    payload: LeadDispatchPayload,
  ): Promise<DispatchResult> {
    const target = 'googleSheets' as const;
    try {
      const accessToken = await getGoogleAccessToken(cfg.refreshToken!);
      if (!accessToken) {
        return {
          target,
          ok: false,
          detail: 'Could not obtain a Google access token — reconnect Google Sheets.',
        };
      }

      const sheetName = cfg.sheetName?.trim() || 'Sheet1';
      const range = `${encodeURIComponent(sheetName)}!A1`;
      const url =
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(cfg.spreadsheetId!)}` +
        `/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

      const row = [
        payload.submittedAt.toISOString(),
        payload.name ?? '',
        payload.phone ?? '',
        payload.email,
        payload.zip ?? '',
        payload.estimatorTitle,
        payload.estimateMin,
        payload.estimateMax,
        payload.currency,
        JSON.stringify(payload.answers),
      ];

      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [row] }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        logger.warn({ status: res.status, body: text.slice(0, 300) }, 'Google Sheets append non-2xx');
        // Extract the Google API error message for a readable diagnostic.
        let msg = text.slice(0, 200);
        try {
          const j = JSON.parse(text);
          msg = j?.error?.message ?? msg;
        } catch {
          /* keep raw text */
        }
        return { target, ok: false, detail: `Sheets API HTTP ${res.status}: ${msg}` };
      }
      return { target, ok: true, detail: 'Row appended' };
    } catch (err) {
      const detail = (err as Error)?.message ?? 'append failed';
      logger.error({ err }, 'Google Sheets append failed');
      return { target, ok: false, detail };
    }
  }
}

function isHttpUrl(u: string | undefined): u is string {
  return !!u && /^https?:\/\//i.test(u);
}

// The widget displays estimate values directly as whole currency units, so we
// format the CRM payload the same way the end-user saw it (no cents division).
function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Exchange a stored Google refresh token for a short-lived access token.
 * Returns null (and logs) when Google OAuth is not configured or the exchange fails.
 */
export async function getGoogleAccessToken(refreshToken: string): Promise<string | null> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    logger.warn('Google Sheets dispatch skipped: GOOGLE_CLIENT_ID/SECRET not configured');
    return null;
  }
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'Google token refresh failed');
      return null;
    }
    const data = (await res.json()) as { access_token?: string };
    return data.access_token ?? null;
  } catch (err) {
    logger.error({ err }, 'Google token refresh threw');
    return null;
  }
}
