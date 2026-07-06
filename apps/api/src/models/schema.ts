import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { randomUUID } from 'crypto';

// ── Tenants ──
export const tenants = sqliteTable('tenants', {
  id: text('id').primaryKey().$defaultFn(() => randomUUID()),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  notificationRecipients: text('notification_recipients', { mode: 'json' })
    .$type<string[]>()
    .$defaultFn(() => []),
  // Org-level branding — the default logo/color/font used across the dashboard
  // chrome and the tenant's widgets (per-estimator branding can override).
  branding: text('branding', { mode: 'json' })
    .$type<{ logoUrl?: string; primaryColor?: string; fontFamily?: string }>()
    .$defaultFn(() => ({})),
  // CRM / lead-routing integrations (GHL webhook, Google Sheets webhook, native
  // Google Sheets OAuth). Google OAuth tokens live here and are never exposed.
  integrations: text('integrations', { mode: 'json' })
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
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// ── Users ──
export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey().$defaultFn(() => randomUUID()),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    phone: text('phone'),
    name: text('name'),
    role: text('role').notNull().default('member'), // owner | admin | member
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => ({
    tenantIdx: index('users_tenant_idx').on(t.tenantId),
    emailIdx: index('users_email_idx').on(t.email),
  }),
);

// ── OTP Codes ──
export const otpCodes = sqliteTable(
  'otp_codes',
  {
    id: text('id').primaryKey().$defaultFn(() => randomUUID()),
    identifier: text('identifier').notNull(), // email or phone
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    lockedUntil: integer('locked_until', { mode: 'timestamp' }),
    usedAt: integer('used_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => ({
    identifierIdx: index('otp_identifier_idx').on(t.identifier),
  }),
);

// ── Estimators ──
export const estimators = sqliteTable(
  'estimators',
  {
    id: text('id').primaryKey().$defaultFn(() => randomUUID()),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    publicKey: text('public_key').notNull().unique(),
    title: text('title').notNull(),
    status: text('status').notNull().default('draft'), // draft | published
    currentVersionId: text('current_version_id'),
    branding: text('branding', { mode: 'json' })
      .$type<{ logoUrl?: string; primaryColor?: string; fontFamily?: string }>()
      .$defaultFn(() => ({})),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => ({
    tenantIdx: index('estimators_tenant_idx').on(t.tenantId),
    publicKeyIdx: index('estimators_public_key_idx').on(t.publicKey),
  }),
);

// ── Estimator Versions ──
export const estimatorVersions = sqliteTable('estimator_versions', {
  id: text('id').primaryKey().$defaultFn(() => randomUUID()),
  estimatorId: text('estimator_id').notNull().references(() => estimators.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  questions: text('questions', { mode: 'json' }).$type<any[]>().notNull().$defaultFn(() => []),
  pricingConfigId: text('pricing_config_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
});

// ── Pricing Configs ──
export const pricingConfigs = sqliteTable(
  'pricing_configs',
  {
    id: text('id').primaryKey().$defaultFn(() => randomUUID()),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    estimatorId: text('estimator_id').references(() => estimators.id, { onDelete: 'set null' }),
    config: text('config', { mode: 'json' }).$type<any>().notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => ({
    tenantIdx: index('pricing_configs_tenant_idx').on(t.tenantId),
  }),
);

// ── Service Areas ──
export const serviceAreas = sqliteTable(
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
export const submissions = sqliteTable(
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
    answers: text('answers', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull()
      .$defaultFn(() => ({})),
    estimateMin: integer('estimate_min').notNull(),
    estimateMax: integer('estimate_max').notNull(),
    currency: text('currency').notNull().default('USD'),
    serviceAreaValid: integer('service_area_valid', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => ({
    tenantIdx: index('submissions_tenant_idx').on(t.tenantId),
    estimatorIdx: index('submissions_estimator_idx').on(t.estimatorId),
    createdAtIdx: index('submissions_created_at_idx').on(t.createdAt),
  }),
);

// ── Analytics Events ──
export const analyticsEvents = sqliteTable(
  'analytics_events',
  {
    id: text('id').primaryKey().$defaultFn(() => randomUUID()),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    estimatorId: text('estimator_id').notNull(),
    eventType: text('event_type').notNull(),
    stepId: text('step_id'),
    sessionId: text('session_id').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => ({
    tenantEventIdx: index('analytics_tenant_event_idx').on(t.tenantId, t.eventType),
    createdAtIdx: index('analytics_created_at_idx').on(t.createdAt),
  }),
);

// ── Subscriptions ──
export const subscriptions = sqliteTable(
  'subscriptions',
  {
    id: text('id').primaryKey().$defaultFn(() => randomUUID()),
    tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }).unique(),
    externalId: text('external_id').notNull(),
    status: text('status').notNull().default('trialing'),
    planId: text('plan_id').notNull(),
    currentPeriodEnd: integer('current_period_end', { mode: 'timestamp' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => ({
    tenantIdx: index('subscriptions_tenant_idx').on(t.tenantId),
    externalIdx: index('subscriptions_external_idx').on(t.externalId),
  }),
);

// ── Audit Logs ──
export const auditLogs = sqliteTable(
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
    timestamp: integer('timestamp', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => ({
    tenantIdx: index('audit_logs_tenant_idx').on(t.tenantId),
    timestampIdx: index('audit_logs_timestamp_idx').on(t.timestamp),
  }),
);
