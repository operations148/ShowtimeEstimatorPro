import { z } from 'zod';

const envSchema = z
  .object({
    // ── Database ────────────────────────────────────────────────────────────
    DATABASE_URL: z.string().min(1).default('./dev.db'),

    // ── Session ─────────────────────────────────────────────────────────────
    SESSION_SECRET: z.string().min(32),

    // ── OTP ─────────────────────────────────────────────────────────────────
    OTP_EXPIRY_MINUTES: z.coerce.number().int().positive().default(10),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),

    // ── Email provider ───────────────────────────────────────────────────────
    EMAIL_PROVIDER: z.enum(['mock', 'resend', 'sendgrid', 'postmark', 'ses']).default('mock'),
    RESEND_API_KEY: z.string().optional(),
    RESEND_FROM: z.string().optional(),

    // ── SMS provider ─────────────────────────────────────────────────────────
    SMS_PROVIDER: z.enum(['mock', 'twilio', 'vonage']).default('mock'),
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_FROM: z.string().optional(),

    // ── Payment provider ─────────────────────────────────────────────────────
    PAYMENT_PROVIDER: z.enum(['mock', 'stripe']).default('mock'),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),

    // ── CORS ────────────────────────────────────────────────────────────────
    CORS_WIDGET_ORIGINS: z.string().default('http://localhost:5173'),
    CORS_DASHBOARD_ORIGIN: z.string().default('http://localhost:3000'),

    // ── Server ──────────────────────────────────────────────────────────────
    PORT: z.coerce.number().default(4000),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

    // ── Media / Unsplash ─────────────────────────────────────────────────────
    // Register a free app at https://unsplash.com/developers to get a key.
    // If omitted the image-search endpoint returns an empty array.
    UNSPLASH_ACCESS_KEY: z.string().optional(),

    // ── Scheduled jobs ───────────────────────────────────────────────────────
    // Protect the /api/v1/cron/* endpoints when deployed. Optional in dev.
    CRON_SECRET: z.string().optional(),

    // ── Google OAuth ─────────────────────────────────────────────────────────────
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    GOOGLE_REDIRECT_URI: z.string().optional(),
    // Separate redirect URI for the Google Sheets integration OAuth flow (offline
    // access + Sheets scope). Defaults to the local API callback if unset.
    GOOGLE_SHEETS_REDIRECT_URI: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    // Resend: API key required when provider is active
    if (data.EMAIL_PROVIDER === 'resend' && !data.RESEND_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'RESEND_API_KEY is required when EMAIL_PROVIDER=resend',
        path: ['RESEND_API_KEY'],
      });
    }

    // Twilio: all three credentials required when provider is active
    if (data.SMS_PROVIDER === 'twilio') {
      if (!data.TWILIO_ACCOUNT_SID) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'TWILIO_ACCOUNT_SID is required when SMS_PROVIDER=twilio',
          path: ['TWILIO_ACCOUNT_SID'],
        });
      }
      if (!data.TWILIO_AUTH_TOKEN) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'TWILIO_AUTH_TOKEN is required when SMS_PROVIDER=twilio',
          path: ['TWILIO_AUTH_TOKEN'],
        });
      }
      if (!data.TWILIO_FROM) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'TWILIO_FROM is required when SMS_PROVIDER=twilio',
          path: ['TWILIO_FROM'],
        });
      }
    }

    // Stripe: both keys required when provider is active
    if (data.PAYMENT_PROVIDER === 'stripe') {
      if (!data.STRIPE_SECRET_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'STRIPE_SECRET_KEY is required when PAYMENT_PROVIDER=stripe',
          path: ['STRIPE_SECRET_KEY'],
        });
      }
      if (!data.STRIPE_WEBHOOK_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'STRIPE_WEBHOOK_SECRET is required when PAYMENT_PROVIDER=stripe',
          path: ['STRIPE_WEBHOOK_SECRET'],
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

function parseEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    // Use console here — pino is not yet available at env parse time
    console.error('❌ Invalid environment variables:');
    for (const [field, messages] of Object.entries(result.error.flatten().fieldErrors)) {
      console.error(`  ${field}: ${(messages as string[]).join(', ')}`);
    }
    process.exit(1);
  }
  return result.data;
}

export const env = parseEnv();
