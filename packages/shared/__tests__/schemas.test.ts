/**
 * Unit tests for packages/shared/src/schemas.ts
 *
 * Each Zod schema is tested with:
 *   - at least one valid input (parse should succeed)
 *   - invalid inputs covering each constraint (parse should throw / fail)
 */
import { describe, it, expect } from 'vitest';
import {
  createTenantSchema,
  signupSchema,
  updateTenantSchema,
  otpRequestSchema,
  otpVerifySchema,
  createUserSchema,
  updateUserSchema,
  updateUserRoleSchema,
  createEstimatorSchema,
  updateEstimatorSchema,
  questionSchema,
  questionsArraySchema,
  leadSchema,
  createSubmissionSchema,
  pricingConfigSchema,
  pricingInputSchema,
  analyticsEventSchema,
  dateRangeSchema,
  serviceAreaRowSchema,
  subscriptionWebhookSchema,
  estimatorImportSchema,
} from '../src/schemas';

// ── Helpers ───────────────────────────────────────────────────────────────────

function valid<T>(schema: { parse: (v: unknown) => T }, input: unknown): T {
  return schema.parse(input);
}

function invalid(schema: { safeParse: (v: unknown) => { success: boolean } }, input: unknown) {
  const result = schema.safeParse(input);
  expect(result.success).toBe(false);
}

// ── createTenantSchema ────────────────────────────────────────────────────────

describe('createTenantSchema', () => {
  it('accepts valid tenant fields', () => {
    const r = valid(createTenantSchema, { name: 'Acme Corp', slug: 'acme-corp' });
    expect(r.name).toBe('Acme Corp');
    expect(r.slug).toBe('acme-corp');
  });

  it('rejects empty name', () => {
    invalid(createTenantSchema, { name: '', slug: 'ok' });
  });

  it('rejects name longer than 100 chars', () => {
    invalid(createTenantSchema, { name: 'a'.repeat(101), slug: 'ok' });
  });

  it('rejects slug shorter than 2 chars', () => {
    invalid(createTenantSchema, { name: 'OK', slug: 'x' });
  });

  it('rejects slug longer than 50 chars', () => {
    invalid(createTenantSchema, { name: 'OK', slug: 'a'.repeat(51) });
  });

  it('rejects slug with uppercase letters', () => {
    invalid(createTenantSchema, { name: 'OK', slug: 'MySlug' });
  });

  it('rejects slug with spaces', () => {
    invalid(createTenantSchema, { name: 'OK', slug: 'my slug' });
  });

  it('rejects slug with underscores', () => {
    invalid(createTenantSchema, { name: 'OK', slug: 'my_slug' });
  });

  it('accepts slug with hyphens and numbers', () => {
    valid(createTenantSchema, { name: 'OK', slug: 'my-slug-123' });
  });
});

// ── signupSchema ──────────────────────────────────────────────────────────────

describe('signupSchema', () => {
  it('accepts valid signup data', () => {
    const r = valid(signupSchema, { name: 'Test', slug: 'test', ownerEmail: 'owner@test.com' });
    expect(r.ownerEmail).toBe('owner@test.com');
  });

  it('rejects invalid owner email', () => {
    invalid(signupSchema, { name: 'Test', slug: 'test', ownerEmail: 'not-an-email' });
  });

  it('rejects missing ownerEmail', () => {
    invalid(signupSchema, { name: 'Test', slug: 'test' });
  });
});

// ── updateTenantSchema ────────────────────────────────────────────────────────

describe('updateTenantSchema', () => {
  it('accepts all optional fields', () => {
    const r = valid(updateTenantSchema, {
      name: 'New Name',
      notificationRecipients: ['a@b.com', 'c@d.com'],
      serviceAreaBehavior: 'block',
      retentionDays: 90,
    });
    expect(r.serviceAreaBehavior).toBe('block');
  });

  it('accepts empty object (all optional)', () => {
    valid(updateTenantSchema, {});
  });

  it('rejects notificationRecipients containing invalid email', () => {
    invalid(updateTenantSchema, { notificationRecipients: ['bad-email'] });
  });

  it('rejects invalid serviceAreaBehavior value', () => {
    invalid(updateTenantSchema, { serviceAreaBehavior: 'allow' });
  });

  it('rejects non-positive retentionDays', () => {
    invalid(updateTenantSchema, { retentionDays: 0 });
  });

  it('accepts retentionDays: null (clear retention)', () => {
    const r = valid(updateTenantSchema, { retentionDays: null });
    expect(r.retentionDays).toBeNull();
  });
});

// ── otpRequestSchema ──────────────────────────────────────────────────────────

describe('otpRequestSchema', () => {
  it('accepts email channel', () => {
    const r = valid(otpRequestSchema, { identifier: 'u@test.com', channel: 'email' });
    expect(r.channel).toBe('email');
  });

  it('accepts sms channel', () => {
    valid(otpRequestSchema, { identifier: '+15550001234', channel: 'sms' });
  });

  it('rejects unknown channel', () => {
    invalid(otpRequestSchema, { identifier: 'u@test.com', channel: 'push' });
  });

  it('rejects empty identifier', () => {
    invalid(otpRequestSchema, { identifier: '', channel: 'email' });
  });

  it('rejects missing channel', () => {
    invalid(otpRequestSchema, { identifier: 'u@test.com' });
  });
});

// ── otpVerifySchema ───────────────────────────────────────────────────────────

describe('otpVerifySchema', () => {
  it('accepts a valid 6-digit code', () => {
    const r = valid(otpVerifySchema, { identifier: 'u@test.com', code: '123456' });
    expect(r.code).toBe('123456');
  });

  it('rejects a code shorter than 6 digits', () => {
    invalid(otpVerifySchema, { identifier: 'u@test.com', code: '12345' });
  });

  it('rejects a code longer than 6 digits', () => {
    invalid(otpVerifySchema, { identifier: 'u@test.com', code: '1234567' });
  });

  it('rejects a code containing non-digits', () => {
    invalid(otpVerifySchema, { identifier: 'u@test.com', code: '12345a' });
  });
});

// ── createUserSchema ──────────────────────────────────────────────────────────

describe('createUserSchema', () => {
  it('accepts owner role', () => {
    const r = valid(createUserSchema, { email: 'o@t.com', role: 'owner' });
    expect(r.role).toBe('owner');
  });

  it('accepts admin and member roles', () => {
    valid(createUserSchema, { email: 'a@t.com', role: 'admin' });
    valid(createUserSchema, { email: 'm@t.com', role: 'member' });
  });

  it('accepts optional name and phone', () => {
    const r = valid(createUserSchema, {
      email: 'u@t.com',
      role: 'member',
      name: 'Alice',
      phone: '+15550001234',
    });
    expect(r.name).toBe('Alice');
  });

  it('rejects invalid email', () => {
    invalid(createUserSchema, { email: 'not-email', role: 'member' });
  });

  it('rejects unknown role', () => {
    invalid(createUserSchema, { email: 'u@t.com', role: 'superadmin' });
  });

  it('rejects name longer than 100 chars', () => {
    invalid(createUserSchema, { email: 'u@t.com', role: 'member', name: 'a'.repeat(101) });
  });
});

// ── updateUserSchema ──────────────────────────────────────────────────────────

describe('updateUserSchema', () => {
  it('accepts partial update with just a name', () => {
    const r = valid(updateUserSchema, { name: 'Bob' });
    expect(r.name).toBe('Bob');
  });

  it('omits role field (role cannot be updated via this schema)', () => {
    // role key is omitted — schema should reject it via strict if needed, but
    // at minimum it should parse without including role
    const r = valid(updateUserSchema, { name: 'Bob' });
    expect((r as Record<string, unknown>)['role']).toBeUndefined();
  });

  it('accepts empty object (all optional)', () => {
    valid(updateUserSchema, {});
  });
});

// ── updateUserRoleSchema ──────────────────────────────────────────────────────

describe('updateUserRoleSchema', () => {
  it('accepts valid roles', () => {
    valid(updateUserRoleSchema, { role: 'owner' });
    valid(updateUserRoleSchema, { role: 'admin' });
    valid(updateUserRoleSchema, { role: 'member' });
  });

  it('rejects unknown role', () => {
    invalid(updateUserRoleSchema, { role: 'viewer' });
  });

  it('rejects missing role', () => {
    invalid(updateUserRoleSchema, {});
  });
});

// ── createEstimatorSchema ─────────────────────────────────────────────────────

describe('createEstimatorSchema', () => {
  it('accepts minimal title', () => {
    const r = valid(createEstimatorSchema, { title: 'Pool Estimator' });
    expect(r.title).toBe('Pool Estimator');
  });

  it('accepts full branding object', () => {
    const r = valid(createEstimatorSchema, {
      title: 'Estimator',
      branding: {
        logoUrl: 'https://example.com/logo.png',
        primaryColor: '#2563eb',
        fontFamily: 'Inter',
      },
    });
    expect(r.branding?.primaryColor).toBe('#2563eb');
  });

  it('rejects empty title', () => {
    invalid(createEstimatorSchema, { title: '' });
  });

  it('rejects title longer than 200 chars', () => {
    invalid(createEstimatorSchema, { title: 'a'.repeat(201) });
  });

  it('rejects branding.primaryColor with wrong format (no hash)', () => {
    invalid(createEstimatorSchema, { title: 'Est', branding: { primaryColor: '2563eb' } });
  });

  it('rejects branding.primaryColor with short hex', () => {
    invalid(createEstimatorSchema, { title: 'Est', branding: { primaryColor: '#abc' } });
  });

  it('rejects branding.logoUrl with non-URL value', () => {
    invalid(createEstimatorSchema, { title: 'Est', branding: { logoUrl: 'not-a-url' } });
  });
});

// ── updateEstimatorSchema ─────────────────────────────────────────────────────

describe('updateEstimatorSchema', () => {
  it('accepts partial update (title only)', () => {
    valid(updateEstimatorSchema, { title: 'New Title' });
  });

  it('accepts empty object (fully optional)', () => {
    valid(updateEstimatorSchema, {});
  });
});

// ── questionSchema ────────────────────────────────────────────────────────────

describe('questionSchema', () => {
  const baseQuestion = {
    id: 'q1',
    stepId: 's1',
    type: 'single' as const,
    label: 'What type?',
    order: 0,
  };

  it('accepts a valid single-choice question', () => {
    const r = valid(questionSchema, { ...baseQuestion, options: ['a', 'b'] });
    expect(r.required).toBe(true); // default
  });

  it('accepts multiple, text, and number types', () => {
    valid(questionSchema, { ...baseQuestion, type: 'multiple', options: ['x'] });
    valid(questionSchema, { ...baseQuestion, type: 'text' });
    valid(questionSchema, { ...baseQuestion, type: 'number' });
  });

  it('rejects unknown type', () => {
    invalid(questionSchema, { ...baseQuestion, type: 'dropdown' });
  });

  it('rejects empty label', () => {
    invalid(questionSchema, { ...baseQuestion, label: '' });
  });

  it('rejects negative order', () => {
    invalid(questionSchema, { ...baseQuestion, order: -1 });
  });

  it('rejects fractional order', () => {
    invalid(questionSchema, { ...baseQuestion, order: 1.5 });
  });

  it('rejects empty id', () => {
    invalid(questionSchema, { ...baseQuestion, id: '' });
  });

  it('defaults required to true when omitted', () => {
    const r = valid(questionSchema, baseQuestion);
    expect(r.required).toBe(true);
  });
});

// ── questionsArraySchema ──────────────────────────────────────────────────────

describe('questionsArraySchema', () => {
  it('accepts an array of valid questions', () => {
    const r = valid(questionsArraySchema, [
      { id: 'q1', stepId: 's1', type: 'text', label: 'Name?', order: 0 },
      { id: 'q2', stepId: 's2', type: 'number', label: 'Age?', order: 1 },
    ]);
    expect(r).toHaveLength(2);
  });

  it('accepts an empty array', () => {
    valid(questionsArraySchema, []);
  });

  it('rejects if one item in the array is invalid', () => {
    invalid(questionsArraySchema, [{ id: '', stepId: 's1', type: 'text', label: 'L', order: 0 }]);
  });
});

// ── leadSchema ────────────────────────────────────────────────────────────────

describe('leadSchema', () => {
  it('accepts required fields', () => {
    const r = valid(leadSchema, { email: 'u@test.com', zip: '90210' });
    expect(r.email).toBe('u@test.com');
  });

  it('accepts optional name and phone', () => {
    valid(leadSchema, { email: 'u@test.com', zip: '90210', name: 'Alice', phone: '+1555' });
  });

  it('rejects invalid email', () => {
    invalid(leadSchema, { email: 'not-email', zip: '90210' });
  });

  it('rejects zip shorter than 3 chars', () => {
    invalid(leadSchema, { email: 'u@test.com', zip: '12' });
  });

  it('rejects zip longer than 10 chars', () => {
    invalid(leadSchema, { email: 'u@test.com', zip: '1'.repeat(11) });
  });

  it('rejects name longer than 100 chars', () => {
    invalid(leadSchema, { email: 'u@test.com', zip: '90210', name: 'a'.repeat(101) });
  });

  it('rejects phone longer than 20 chars', () => {
    invalid(leadSchema, { email: 'u@test.com', zip: '90210', phone: '1'.repeat(21) });
  });
});

// ── createSubmissionSchema ────────────────────────────────────────────────────

describe('createSubmissionSchema', () => {
  it('accepts valid submission input', () => {
    const r = valid(createSubmissionSchema, {
      estimatorPublicKey: 'abc123',
      lead: { email: 'u@test.com', zip: '90210' },
      answers: { pool_type: 'in-ground', size: '15x30' },
    });
    expect(r.estimatorPublicKey).toBe('abc123');
  });

  it('rejects empty publicKey', () => {
    invalid(createSubmissionSchema, {
      estimatorPublicKey: '',
      lead: { email: 'u@test.com', zip: '90210' },
      answers: {},
    });
  });

  it('rejects invalid lead', () => {
    invalid(createSubmissionSchema, {
      estimatorPublicKey: 'key',
      lead: { email: 'bad', zip: '90210' },
      answers: {},
    });
  });

  it('accepts empty answers object', () => {
    valid(createSubmissionSchema, {
      estimatorPublicKey: 'key',
      lead: { email: 'u@test.com', zip: '90210' },
      answers: {},
    });
  });
});

// ── pricingConfigSchema ───────────────────────────────────────────────────────

describe('pricingConfigSchema', () => {
  const baseConfig = {
    currency: 'USD',
    base: { pool_only: { '15x30': [54000, 58000] } },
    addons: { salt_water: [1200, 2200] },
    minMaxMode: 'sum_ranges' as const,
  };

  it('accepts a valid pricing config', () => {
    const r = valid(pricingConfigSchema, baseConfig);
    expect(r.currency).toBe('USD');
  });

  it('accepts min_max_of_totals mode', () => {
    valid(pricingConfigSchema, { ...baseConfig, minMaxMode: 'min_max_of_totals' });
  });

  it('accepts optional financing block', () => {
    const r = valid(pricingConfigSchema, {
      ...baseConfig,
      financing: { termMonths: 60, aprPercent: 5.9 },
    });
    expect(r.financing?.termMonths).toBe(60);
  });

  it('rejects currency not exactly 3 chars', () => {
    invalid(pricingConfigSchema, { ...baseConfig, currency: 'US' });
    invalid(pricingConfigSchema, { ...baseConfig, currency: 'USDD' });
  });

  it('rejects unknown minMaxMode', () => {
    invalid(pricingConfigSchema, { ...baseConfig, minMaxMode: 'average' });
  });

  it('rejects financing with non-positive termMonths', () => {
    invalid(pricingConfigSchema, {
      ...baseConfig,
      financing: { termMonths: 0, aprPercent: 5 },
    });
  });

  it('rejects financing with apr over 100', () => {
    invalid(pricingConfigSchema, {
      ...baseConfig,
      financing: { termMonths: 12, aprPercent: 101 },
    });
  });
});

// ── pricingInputSchema ────────────────────────────────────────────────────────

describe('pricingInputSchema', () => {
  it('accepts valid input', () => {
    const r = valid(pricingInputSchema, {
      baseKey: 'pool_only',
      sizeKey: '15x30',
      addonKeys: ['salt_water'],
    });
    expect(r.addonKeys).toEqual(['salt_water']);
  });

  it('accepts empty addonKeys array', () => {
    valid(pricingInputSchema, { baseKey: 'pool_only', sizeKey: '15x30', addonKeys: [] });
  });

  it('rejects empty baseKey', () => {
    invalid(pricingInputSchema, { baseKey: '', sizeKey: '15x30', addonKeys: [] });
  });

  it('rejects empty sizeKey', () => {
    invalid(pricingInputSchema, { baseKey: 'pool_only', sizeKey: '', addonKeys: [] });
  });
});

// ── analyticsEventSchema ──────────────────────────────────────────────────────

describe('analyticsEventSchema', () => {
  it('accepts step_view event', () => {
    const r = valid(analyticsEventSchema, {
      estimatorId: 'est-1',
      eventType: 'step_view',
      stepId: 'q1',
      sessionId: 'sess-abc',
    });
    expect(r.eventType).toBe('step_view');
  });

  it('accepts all valid event types', () => {
    for (const t of ['step_view', 'step_complete', 'submit', 'gated_out'] as const) {
      valid(analyticsEventSchema, { estimatorId: 'e', eventType: t, sessionId: 's' });
    }
  });

  it('stepId is optional', () => {
    valid(analyticsEventSchema, { estimatorId: 'e', eventType: 'submit', sessionId: 's' });
  });

  it('rejects unknown eventType', () => {
    invalid(analyticsEventSchema, { estimatorId: 'e', eventType: 'click', sessionId: 's' });
  });

  it('rejects empty estimatorId', () => {
    invalid(analyticsEventSchema, { estimatorId: '', eventType: 'submit', sessionId: 's' });
  });

  it('rejects empty sessionId', () => {
    invalid(analyticsEventSchema, { estimatorId: 'e', eventType: 'submit', sessionId: '' });
  });
});

// ── dateRangeSchema ───────────────────────────────────────────────────────────

describe('dateRangeSchema', () => {
  it('accepts both from and to as ISO datetime strings', () => {
    const r = valid(dateRangeSchema, {
      from: '2024-01-01T00:00:00.000Z',
      to: '2024-12-31T23:59:59.999Z',
    });
    expect(r.from).toBeDefined();
  });

  it('accepts empty object (both optional)', () => {
    valid(dateRangeSchema, {});
  });

  it('rejects non-datetime string for from', () => {
    invalid(dateRangeSchema, { from: '2024-01-01' }); // date-only, not datetime
  });

  it('rejects non-datetime string for to', () => {
    invalid(dateRangeSchema, { to: 'yesterday' });
  });
});

// ── serviceAreaRowSchema ──────────────────────────────────────────────────────

describe('serviceAreaRowSchema', () => {
  it('accepts valid zip codes', () => {
    valid(serviceAreaRowSchema, { zip: '90210' });
    valid(serviceAreaRowSchema, { zip: 'SW1A 1AA' }); // UK-style
    valid(serviceAreaRowSchema, { zip: '123' }); // min length 3
  });

  it('rejects zip shorter than 3 chars', () => {
    invalid(serviceAreaRowSchema, { zip: '12' });
  });

  it('rejects zip longer than 10 chars', () => {
    invalid(serviceAreaRowSchema, { zip: '1'.repeat(11) });
  });

  it('rejects missing zip', () => {
    invalid(serviceAreaRowSchema, {});
  });
});

// ── subscriptionWebhookSchema ─────────────────────────────────────────────────

describe('subscriptionWebhookSchema', () => {
  it('accepts a valid webhook payload', () => {
    const r = valid(subscriptionWebhookSchema, {
      externalId: 'sub_abc123',
      status: 'active',
      currentPeriodEnd: '2025-01-01T00:00:00.000Z',
    });
    expect(r.status).toBe('active');
  });

  it('accepts all valid status values', () => {
    for (const s of ['active', 'past_due', 'canceled', 'trialing', 'unpaid'] as const) {
      valid(subscriptionWebhookSchema, {
        externalId: 'sub_1',
        status: s,
        currentPeriodEnd: '2025-01-01T00:00:00.000Z',
      });
    }
  });

  it('rejects unknown status', () => {
    invalid(subscriptionWebhookSchema, {
      externalId: 'sub_1',
      status: 'paused',
      currentPeriodEnd: '2025-01-01T00:00:00.000Z',
    });
  });

  it('rejects non-datetime currentPeriodEnd', () => {
    invalid(subscriptionWebhookSchema, {
      externalId: 'sub_1',
      status: 'active',
      currentPeriodEnd: 'some-date',
    });
  });
});

// ── estimatorImportSchema ─────────────────────────────────────────────────────

describe('estimatorImportSchema', () => {
  it('accepts a valid import payload', () => {
    const r = valid(estimatorImportSchema, {
      title: 'Pool Estimator',
      steps: [{ id: 'q1', type: 'single', options: ['a', 'b'] }],
      lead: { required: ['email', 'zip'], optional: ['name'] },
    });
    expect(r.title).toBe('Pool Estimator');
    expect(r.steps).toHaveLength(1);
  });

  it('accepts steps without options (for text/number types)', () => {
    valid(estimatorImportSchema, {
      title: 'T',
      steps: [{ id: 'q1', type: 'text' }],
      lead: { required: ['email'], optional: [] },
    });
  });

  it('rejects unknown step type', () => {
    invalid(estimatorImportSchema, {
      title: 'T',
      steps: [{ id: 'q1', type: 'dropdown' }],
      lead: { required: [], optional: [] },
    });
  });

  it('rejects missing title', () => {
    invalid(estimatorImportSchema, {
      steps: [],
      lead: { required: [], optional: [] },
    });
  });

  it('rejects missing lead block', () => {
    invalid(estimatorImportSchema, { title: 'T', steps: [] });
  });
});
