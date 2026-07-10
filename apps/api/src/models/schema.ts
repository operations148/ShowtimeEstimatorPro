import { pgTable, text, integer, timestamp, jsonb, boolean, index, primaryKey } from 'drizzle-orm/pg-core';
import { randomUUID } from 'crypto';

const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().$defaultFn(() => new Date());
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true }).notNull().$defaultFn(() => new Date());

// ── Tenants ──
export const tenants = pgTable('tenants', {
  id: text('id').primaryKey().$defaultFn(() => randomUUID()),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  notificationRecipients: jsonb('notification_recipients')
    .$type<string[]>()
    .$defaultFn(() => []),
  // Org-level branding — the default logo/color/font used across the dashboard
  // chrome and the tenant's widgets (per-estimator branding can override).
  branding: jsonb('branding')
    .$type<{ logoUrl?: string; primaryColor?: string; fontFamily?: string; bookingUrl?: string }>()
    .$defaultFn(() => ({})),
  // CRM / lead-routing integrations (GHL webhook, Google Sheets webhook, native
  // Google Sheets OAuth). Google OAuth tokens live here and are never exposed.
  integrations: jsonb('integrations')
    .$type<{
      ghl?: { enabled: boolean; webhookUrl: string };
      sheetsWebhook?: { enabled: boolean; webhookUrl: string };
      googleSheets?: {
        enabled: boolean;
        spreadsheetId?: string;
        sheetName?: string;
        refreshToken?: string;
        connectedEmail?: string;
      };
    }>()
    .$defaultFn(() => ({})),
  serviceAreaBehavior: text('service_area_behavior').notNull().default('block'), // 'block' | 'warn'
  retentionDays: integer('retention_days'), // null = indefinite
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ── Users ──
export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey().$defaultFn(() => randomUUID()),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    phone: text('phone'),
    name: text('name'),
    role: text('role').notNull().default('member'), // owner | admin | member
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    tenantIdx: index('users_tenant_idx').on(t.tenantId),
    emailIdx: index('users_email_idx').on(t.email),
  }),
);

// ── OTP Codes ──
export const otpCodes = pgTable(
  'otp_codes',
  {
    id: text('id').primaryKey().$defaultFn(() => randomUUID()),
    identifier: text('identifier').notNull(), // email or phone
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => ({
    identifierIdx: index('otp_identifier_idx').on(t.identifier),
  }),
);

// ── Estimators ──
export const estimators = pgTable(
  'estimators',
  {
    id: text('id').primaryKey().$defaultFn(() => randomUUID()),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    publicKey: text('public_key').notNull().unique(),
    title: text('title').notNull(),
    status: text('status').notNull().default('draft'), // draft | published
    currentVersionId: text('current_version_id'),
    branding: jsonb('branding')
      .$type<{ logoUrl?: string; primaryColor?: string; fontFamily?: string; bookingUrl?: string }>()
      .$defaultFn(() => ({})),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    tenantIdx: index('estimators_tenant_idx').on(t.tenantId),
    publicKeyIdx: index('estimators_public_key_idx').on(t.publicKey),
  }),
);

// ── Estimator Versions ──
export const estimatorVersions = pgTable('estimator_versions', {
  id: text('id').primaryKey().$defaultFn(() => randomUUID()),
  estimatorId: text('estimator_id').notNull().references(() => estimators.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  questions: jsonb('questions').$type<any[]>().notNull().$defaultFn(() => []),
  pricingConfigId: text('pricing_config_id'),
  createdAt: createdAt(),
});

// ── Pricing Configs ──
export const pricingConfigs = pgTable(
  'pricing_configs',
  {
    id: text('id').primaryKey().$defaultFn(() => randomUUID()),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    estimatorId: text('estimator_id').references(() => estimators.id, { onDelete: 'set null' }),
    config: jsonb('config').$type<any>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    tenantIdx: index('pricing_configs_tenant_idx').on(t.tenantId),
  }),
);

// ── Service Areas ──
export const serviceAreas = pgTable(
  'service_areas',
  {
    id: text('id').primaryKey().$defaultFn(() => randomUUID()),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    zip: text('zip').notNull(),
  },
  (t) => ({
    tenantZipIdx: index('service_areas_tenant_zip_idx').on(t.tenantId, t.zip),
  }),
);

// ── Submissions ──
export const submissions = pgTable(
  'submissions',
  {
    id: text('id').primaryKey().$defaultFn(() => randomUUID()),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    estimatorId: text('estimator_id').notNull().references(() => estimators.id),
    versionId: text('version_id').notNull(),
    leadEmail: text('lead_email').notNull(),
    leadZip: text('lead_zip'), // optional — provided only when the lead enters a zip
    leadName: text('lead_name'),
    leadPhone: text('lead_phone'),
    answers: jsonb('answers').$type<Record<string, unknown>>().notNull().$defaultFn(() => ({})),
    estimateMin: integer('estimate_min').notNull(),
    estimateMax: integer('estimate_max').notNull(),
    currency: text('currency').notNull().default('USD'),
    serviceAreaValid: boolean('service_area_valid').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => ({
    tenantIdx: index('submissions_tenant_idx').on(t.tenantId),
    estimatorIdx: index('submissions_estimator_idx').on(t.estimatorId),
    createdAtIdx: index('submissions_created_at_idx').on(t.createdAt),
  }),
);

// ── Analytics Events ──
export const analyticsEvents = pgTable(
  'analytics_events',
  {
    id: text('id').primaryKey().$defaultFn(() => randomUUID()),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    estimatorId: text('estimator_id').notNull(),
    eventType: text('event_type').notNull(),
    stepId: text('step_id'),
    sessionId: text('session_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => ({
    tenantEventIdx: index('analytics_tenant_event_idx').on(t.tenantId, t.eventType),
    createdAtIdx: index('analytics_created_at_idx').on(t.createdAt),
  }),
);

// ── Subscriptions ──
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: text('id').primaryKey().$defaultFn(() => randomUUID()),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }).unique(),
    externalId: text('external_id').notNull(),
    status: text('status').notNull().default('trialing'),
    planId: text('plan_id').notNull(),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    tenantIdx: index('subscriptions_tenant_idx').on(t.tenantId),
    externalIdx: index('subscriptions_external_idx').on(t.externalId),
  }),
);

// ── Audit Logs ──
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: text('id').primaryKey().$defaultFn(() => randomUUID()),
    tenantId: text('tenant_id').notNull(),
    actorId: text('actor_id').notNull(),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().$defaultFn(() => new Date()),
  },
  (t) => ({
    tenantIdx: index('audit_logs_tenant_idx').on(t.tenantId),
    timestampIdx: index('audit_logs_timestamp_idx').on(t.timestamp),
  }),
);

// ── Processed webhook events (C1: idempotent payment webhook processing) ──
// The provider event id is the primary key; a duplicate delivery is a no-op insert.
export const processedWebhookEvents = pgTable('processed_webhook_events', {
  id: text('id').primaryKey(),
  processedAt: timestamp('processed_at', { withTimezone: true }).notNull().$defaultFn(() => new Date()),
});

// ── Rate limit hits (H2: durable, cross-instance rate limiting) ──
// One row per (bucket, window-start). `count` is incremented atomically. `windowStart`
// makes old windows prunable. Bucket encodes the limiter key (e.g. "otp:1.2.3.4").
export const rateLimitHits = pgTable(
  'rate_limit_hits',
  {
    bucket: text('bucket').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.bucket, t.windowStart] }),
    windowIdx: index('rate_limit_window_idx').on(t.windowStart),
  }),
);
