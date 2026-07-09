// ──────────────────────────────────────────────
// Core domain types
// ──────────────────────────────────────────────

export type TenantId = string;
export type UserId = string;
export type EstimatorId = string;
export type SubmissionId = string;

export type UserRole = 'owner' | 'admin' | 'member';
export type SubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'trialing' | 'unpaid';
export type EstimatorStatus = 'draft' | 'published';

export interface Tenant {
  id: TenantId;
  slug: string;
  name: string;
  branding?: TenantBranding | null;
  integrations?: TenantIntegrations | null;
  createdAt: Date;
  updatedAt: Date;
}

// Org-level branding. Same shape as EstimatorBranding; used as the default that
// per-estimator branding can override, and shown in the dashboard chrome.
export type TenantBranding = EstimatorBranding;

// CRM / lead-routing integrations. Google Sheets can be wired either via a
// pasteable webhook (Apps Script / Zapier) or a native OAuth connection.
export interface TenantIntegrations {
  ghl?: { enabled: boolean; webhookUrl: string };
  sheetsWebhook?: { enabled: boolean; webhookUrl: string };
  googleSheets?: {
    enabled: boolean;
    spreadsheetId?: string;
    sheetName?: string;
    refreshToken?: string; // server-managed OAuth token — never returned to clients
    connectedEmail?: string;
  };
}

export interface User {
  id: UserId;
  tenantId: TenantId;
  email: string;
  phone?: string | null;
  name?: string | null;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

export interface Estimator {
  id: EstimatorId;
  tenantId: TenantId;
  publicKey: string;
  title: string;
  status: EstimatorStatus;
  currentVersionId?: string | null;
  branding: EstimatorBranding;
  createdAt: Date;
  updatedAt: Date;
}

export interface EstimatorBranding {
  logoUrl?: string | null;
  primaryColor?: string;
  fontFamily?: string;
}

export interface EstimatorVersion {
  id: string;
  estimatorId: EstimatorId;
  version: number;
  questions: EstimatorQuestion[];
  pricingConfigId?: string | null;
  createdAt: Date;
}

export interface EstimatorQuestion {
  id: string;
  stepId: string;
  type: 'single' | 'multiple' | 'text' | 'number';
  label: string;
  options?: string[];
  // option label → a single image URL (legacy) or up to 2 URLs for a carousel
  optionImages?: Record<string, string | string[]>;
  required: boolean;
  order: number;
}

export interface LeadFields {
  email: string;
  zip?: string | null;
  name?: string | null;
  phone?: string | null;
}

export interface Submission {
  id: SubmissionId;
  tenantId: TenantId;
  estimatorId: EstimatorId;
  versionId: string;
  leadEmail: string;
  leadZip?: string | null;
  leadName?: string | null;
  leadPhone?: string | null;
  answers: Record<string, unknown>;
  estimateMin: number;
  estimateMax: number;
  currency: string;
  serviceAreaValid: boolean;
  createdAt: Date;
}

// ──────────────────────────────────────────────
// Pricing engine types
// ──────────────────────────────────────────────

export interface PricingConfig {
  currency: string;
  base: Record<string, Record<string, [number, number]>>;
  addons: Record<string, [number, number]>;
  minMaxMode: 'sum_ranges' | 'min_max_of_totals';
  financing?: FinancingConfig;
}

export interface FinancingConfig {
  termMonths: number;
  aprPercent: number;
}

export interface PricingResult {
  min: number;
  max: number;
  currency: string;
  financing?: {
    monthlyMin: number;
    monthlyMax: number;
    termMonths: number;
    aprPercent: number;
  };
}

export interface PricingInput {
  baseKey: string;
  sizeKey: string;
  addonKeys: string[];
}

// ──────────────────────────────────────────────
// Analytics types
// ──────────────────────────────────────────────

export type AnalyticsEventType = 'step_view' | 'step_complete' | 'submit' | 'gated_out';

export interface AnalyticsEvent {
  id: string;
  tenantId: TenantId;
  estimatorId: EstimatorId;
  eventType: AnalyticsEventType;
  stepId?: string | null;
  sessionId: string;
  createdAt: Date;
}

export interface AnalyticsSummary {
  totalSubmissions: number;
  totalEstimatedRevenue: number;
  averageEstimate: number;
  submissionsOverTime: { date: string; count: number }[];
  revenueOverTime: { date: string; revenue: number }[];
  dropOffByStep: { stepId: string; views: number; completions: number; dropOffRate: number }[];
}

// ──────────────────────────────────────────────
// Subscription / billing types
// ──────────────────────────────────────────────

export interface Subscription {
  id: string;
  tenantId: TenantId;
  externalId: string;
  status: SubscriptionStatus;
  planId: string;
  currentPeriodEnd: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ──────────────────────────────────────────────
// API response envelope
// ──────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T | null;
  error: { code: string; message: string } | null;
  meta?: { page?: number; total?: number; limit?: number };
}

// ──────────────────────────────────────────────
// OTP types
// ──────────────────────────────────────────────

export interface OtpRequest {
  identifier: string;
  channel: 'email' | 'sms';
}

export interface OtpVerifyRequest {
  identifier: string;
  code: string;
}

// ──────────────────────────────────────────────
// Service area
// ──────────────────────────────────────────────

export interface ServiceAreaEntry {
  tenantId: TenantId;
  zip: string;
}

// ──────────────────────────────────────────────
// Audit log
// ──────────────────────────────────────────────

export interface AuditLogEntry {
  id: string;
  tenantId: TenantId;
  actorId: UserId;
  action: string;
  resourceType: string;
  resourceId: string;
  timestamp: Date;
  ipAddress: string;
  userAgent?: string;
}

// ──────────────────────────────────────────────
// Notification
// ──────────────────────────────────────────────

export interface NotificationRecipient {
  email: string;
  name?: string;
}

export interface LeadNotificationPayload {
  tenantName: string;
  estimatorTitle: string;
  lead: LeadFields;
  estimateMin: number;
  estimateMax: number;
  currency: string;
  submittedAt: Date;
}
