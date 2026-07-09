import { z } from 'zod';

// ── Branding (shared by tenant org branding + per-estimator branding) ──
// logoUrl accepts an absolute URL (from POST /media/upload) or a data: URL.
export const brandingSchema = z.object({
  logoUrl: z.string().url().optional(),
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  fontFamily: z.string().max(100).optional(),
  // Optional booking/scheduling URL (e.g. a GHL calendar). When set, the widget
  // shows a "Book Your Appointment" CTA after the estimate is revealed.
  bookingUrl: z.string().url().optional(),
});

// ── Tenant ──
export const createTenantSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/),
});

export const signupSchema = createTenantSchema.extend({
  ownerEmail: z.string().email(),
});

export const updateTenantSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  notificationRecipients: z.array(z.string().email()).optional(),
  serviceAreaBehavior: z.enum(['block', 'warn']).optional(),
  retentionDays: z.number().int().positive().nullable().optional(),
  branding: brandingSchema.optional(),
});

// ── Integrations (CRM / lead routing) ──
// Client-settable portion only. Google Sheets OAuth tokens (refreshToken,
// connectedEmail) are managed server-side by the OAuth flow, never by the client.
const webhookTargetSchema = z.object({
  enabled: z.boolean(),
  webhookUrl: z.string().max(500),
});

export const updateIntegrationsSchema = z.object({
  ghl: webhookTargetSchema.optional(),
  sheetsWebhook: webhookTargetSchema.optional(),
  googleSheets: z
    .object({
      enabled: z.boolean(),
      spreadsheetId: z.string().max(200).optional(),
      sheetName: z.string().max(200).optional(),
    })
    .optional(),
});

// ── Auth / OTP ──
export const otpRequestSchema = z.object({
  identifier: z.string().min(1),
  channel: z.enum(['email', 'sms']),
});

export const otpVerifySchema = z.object({
  identifier: z.string().min(1),
  code: z.string().length(6).regex(/^\d{6}$/),
});

// ── User ──
export const createUserSchema = z.object({
  email: z.string().email(),
  phone: z.string().optional(),
  name: z.string().max(100).optional(),
  role: z.enum(['owner', 'admin', 'member']),
});

export const updateUserSchema = createUserSchema.partial().omit({ role: true });

export const updateUserRoleSchema = z.object({
  role: z.enum(['owner', 'admin', 'member']),
});

// ── Estimator ──
export const createEstimatorSchema = z.object({
  title: z.string().min(1).max(200),
  branding: brandingSchema.optional(),
});

export const updateEstimatorSchema = createEstimatorSchema.partial();

// ── Question ──
export const questionSchema = z.object({
  id: z.string().min(1),
  stepId: z.string().min(1),
  type: z.enum(['single', 'multiple', 'text', 'number']),
  label: z.string().min(1).max(500),
  options: z.array(z.string()).optional(),
  // Per option: a single image URL (legacy) OR up to 2 image URLs for a carousel.
  optionImages: z
    .record(z.union([z.string(), z.array(z.string()).max(2)]))
    .optional(),
  required: z.boolean().default(true),
  order: z.number().int().min(0),
});

export const questionsArraySchema = z.array(questionSchema);

// ── Lead / Submission ──
// Required contact fields: name, phone, email. Zip is optional and, when
// provided, is used for service-area gating.
export const leadSchema = z.object({
  name: z.string().min(1).max(100),
  phone: z.string().min(1).max(20),
  email: z.string().email(),
  zip: z.string().min(3).max(10).optional(),
});

export const createSubmissionSchema = z.object({
  estimatorPublicKey: z.string().min(1),
  lead: leadSchema,
  answers: z.record(z.unknown()),
});

// ── Pricing config ──
export const pricingConfigSchema = z.object({
  currency: z.string().length(3),
  base: z.record(z.record(z.tuple([z.number(), z.number()]))),
  addons: z.record(z.tuple([z.number(), z.number()])),
  minMaxMode: z.enum(['sum_ranges', 'min_max_of_totals']),
  financing: z
    .object({
      termMonths: z.number().int().positive(),
      aprPercent: z.number().min(0).max(100),
    })
    .optional(),
});

// ── Pricing input ──
export const pricingInputSchema = z.object({
  baseKey: z.string().min(1),
  sizeKey: z.string().min(1),
  addonKeys: z.array(z.string()),
});

// ── Analytics event ──
export const analyticsEventSchema = z.object({
  estimatorId: z.string().min(1),
  eventType: z.enum(['step_view', 'step_complete', 'submit', 'gated_out']),
  stepId: z.string().optional(),
  sessionId: z.string().min(1),
});

// ── Date range filter ──
export const dateRangeSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

// ── Service area import ──
export const serviceAreaRowSchema = z.object({
  zip: z.string().min(3).max(10),
});

// ── Subscription webhook ──
export const subscriptionWebhookSchema = z.object({
  externalId: z.string(),
  status: z.enum(['active', 'past_due', 'canceled', 'trialing', 'unpaid']),
  currentPeriodEnd: z.string().datetime(),
});

// ── Estimator import (matches attachments/estimator-questions.sample.json) ──
export const estimatorImportSchema = z.object({
  title: z.string(),
  steps: z.array(
    z.object({
      id: z.string(),
      type: z.enum(['single', 'multiple', 'text', 'number']),
      options: z.array(z.string()).optional(),
    }),
  ),
  lead: z.object({
    required: z.array(z.string()),
    optional: z.array(z.string()),
  }),
});
