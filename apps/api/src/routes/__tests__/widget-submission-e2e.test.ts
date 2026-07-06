/**
 * End-to-end integration test for the widget → submission flow.
 *
 * Simulates what happens when an end-user fills in the embeddable widget:
 *   1. Widget fetches its config via GET /widget/:publicKey
 *   2. User fills in the form and submits via POST /submissions
 *
 * Tests cover the happy path, service-area gating (block + warn),
 * pricing integration, analytics tracking, and notification delivery.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { fileURLToPath } from 'url';
import path from 'path';
import * as crypto from 'crypto';
import { eq } from 'drizzle-orm';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { MockEmailProvider } from '@repo/provider-adapters';
import { createWidgetRoutes } from '../widget';
import { createSubmissionRoutes } from '../submissions';
import * as schema from '../../models/schema';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_FOLDER = path.resolve(__dirname, '../../../drizzle');

// ── DB factory ────────────────────────────────────────────────────────────────

function createTestDb(): BetterSQLite3Database<typeof schema> {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

// ── Full fixture setup ────────────────────────────────────────────────────────

interface E2EFixture {
  db: BetterSQLite3Database<typeof schema>;
  widgetApp: ReturnType<typeof createWidgetRoutes>;
  submissionApp: ReturnType<typeof createSubmissionRoutes>;
  mockEmail: MockEmailProvider;
  publicKey: string;
  tenantId: string;
  estimatorId: string;
}

const SAMPLE_PRICING = {
  currency: 'USD',
  base: { pool_only: { '15x30': [54000, 58000], '20x40': [72000, 80000] } },
  addons: { salt_water: [1200, 2200], led_lighting: [800, 1500] },
  minMaxMode: 'sum_ranges' as const,
};

const SAMPLE_QUESTIONS = [
  {
    id: 'pool_type',
    stepId: 'pool_type',
    type: 'single' as const,
    label: 'Pool type',
    options: ['pool_only', 'pool_spa'],
    required: true,
    order: 0,
  },
  {
    id: 'pool_size',
    stepId: 'pool_size',
    type: 'single' as const,
    label: 'Pool size',
    options: ['15x30', '20x40'],
    required: true,
    order: 1,
  },
];

async function setupE2E(opts: {
  serviceAreaBehavior?: 'block' | 'warn';
  configureServiceArea?: boolean;
  notificationRecipients?: string[];
  publishEstimator?: boolean;
} = {}): Promise<E2EFixture> {
  const {
    serviceAreaBehavior = 'block',
    configureServiceArea = false,
    notificationRecipients = [],
    publishEstimator = true,
  } = opts;

  const db = createTestDb();

  // Tenant
  const [tenant] = db
    .insert(schema.tenants)
    .values({
      slug: `e2e-${crypto.randomBytes(4).toString('hex')}`,
      name: 'E2E Test Co',
      serviceAreaBehavior,
      notificationRecipients,
    })
    .returning()
    .all();

  // Estimator
  const publicKey = crypto.randomBytes(16).toString('hex');
  const [est] = db
    .insert(schema.estimators)
    .values({
      tenantId: tenant!.id,
      publicKey,
      title: 'Pool Cost Estimator',
      status: publishEstimator ? 'published' : 'draft',
      branding: { primaryColor: '#2563eb' },
    })
    .returning()
    .all();

  // Version with questions
  const [version] = db
    .insert(schema.estimatorVersions)
    .values({ estimatorId: est!.id, version: 1, questions: SAMPLE_QUESTIONS })
    .returning()
    .all();

  db.update(schema.estimators)
    .set({ currentVersionId: version!.id })
    .where(eq(schema.estimators.id, est!.id))
    .run();

  // Pricing config
  db.insert(schema.pricingConfigs)
    .values({ tenantId: tenant!.id, estimatorId: est!.id, config: SAMPLE_PRICING })
    .run();

  // Optionally configure a service area (94103, 94107 only)
  if (configureServiceArea) {
    db.insert(schema.serviceAreas)
      .values([
        { tenantId: tenant!.id, zip: '94103' },
        { tenantId: tenant!.id, zip: '94107' },
      ])
      .run();
  }

  const mockEmail = new MockEmailProvider();
  const widgetApp = createWidgetRoutes(db);
  const submissionApp = createSubmissionRoutes(db, mockEmail);

  return {
    db,
    widgetApp,
    submissionApp,
    mockEmail,
    publicKey,
    tenantId: tenant!.id,
    estimatorId: est!.id,
  };
}

// ── GET /widget/:publicKey ────────────────────────────────────────────────────

describe('GET /widget/:publicKey', () => {
  it('returns full widget config for a published estimator', async () => {
    const f = await setupE2E();

    const res = await f.widgetApp.request(`/${f.publicKey}`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as any;
    expect(body.error).toBeNull();
    const d = body.data;

    expect(d.estimatorId).toBe(f.estimatorId);
    expect(d.publicKey).toBe(f.publicKey);
    expect(d.title).toBe('Pool Cost Estimator');
    expect(d.tenantName).toBe('E2E Test Co');
    expect(d.serviceAreaBehavior).toBe('block');
    expect(d.branding.primaryColor).toBe('#2563eb');

    // Questions from the published version
    expect(d.questions).toHaveLength(2);
    expect(d.questions[0].id).toBe('pool_type');
    expect(d.questions[1].id).toBe('pool_size');

    // Lead field config — name, phone, email required; zip optional
    expect(d.leadConfig.required).toContain('name');
    expect(d.leadConfig.required).toContain('phone');
    expect(d.leadConfig.required).toContain('email');
    expect(d.leadConfig.optional).toContain('zip');
  });

  it('returns 404 for a draft estimator', async () => {
    const f = await setupE2E({ publishEstimator: false });
    const res = await f.widgetApp.request(`/${f.publicKey}`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as any).error.code).toBe('NOT_FOUND');
  });

  it('returns 404 for unknown publicKey', async () => {
    const f = await setupE2E();
    const res = await f.widgetApp.request('/nonexistent-key');
    expect(res.status).toBe(404);
  });

  it('returns empty questions array when estimator has no current version', async () => {
    const db = createTestDb();
    const [tenant] = db
      .insert(schema.tenants)
      .values({ slug: 'noversion', name: 'No Version Co' })
      .returning()
      .all();
    const pk = crypto.randomBytes(16).toString('hex');
    db.insert(schema.estimators)
      .values({
        tenantId: tenant!.id,
        publicKey: pk,
        title: 'No version',
        status: 'published',
        branding: {},
        // currentVersionId intentionally left null
      })
      .run();

    const app = createWidgetRoutes(db);
    const res = await app.request(`/${pk}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data.questions).toEqual([]);
  });
});

// ── POST /submissions — happy path ────────────────────────────────────────────

describe('POST /submissions — happy path', () => {
  let f: E2EFixture;
  beforeEach(async () => { f = await setupE2E(); });

  const submit = (f: E2EFixture, overrides: Record<string, unknown> = {}) =>
    f.submissionApp.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        estimatorPublicKey: f.publicKey,
        lead: { email: 'user@test.com', zip: '94103', name: 'Test User', phone: '555-0100' },
        answers: { baseKey: 'pool_only', sizeKey: '15x30', addonKeys: [] },
        sessionId: 'sess-abc',
        ...overrides,
      }),
    });

  it('returns 201 with submissionId and estimate range', async () => {
    const res = await submit(f);
    expect(res.status).toBe(201);

    const body = (await res.json()) as any;
    expect(body.error).toBeNull();
    expect(body.data.submissionId).toBeTruthy();
    expect(body.data.estimate.min).toBe(54000);
    expect(body.data.estimate.max).toBe(58000);
    expect(body.data.estimate.currency).toBe('USD');
  });

  it('rejects a submission missing the required name/phone (400)', async () => {
    // Zip is optional; name, phone, and email are required.
    const res = await submit(f, { lead: { email: 'x@y.com', zip: '94103' } });
    expect(res.status).toBe(400);
  });

  it('accepts a submission without a zip (zip is optional)', async () => {
    const res = await submit(f, {
      lead: { email: 'x@y.com', name: 'No Zip', phone: '555-0100' },
    });
    expect(res.status).toBe(201);
    const [sub] = f.db.select().from(schema.submissions).all();
    expect(sub!.leadZip).toBeNull();
  });

  it('silently drops a honeypot-filled (spam) submission', async () => {
    const res = await submit(f, { company: 'spam-bot-inc' });
    expect(res.status).toBe(201);
    const rows = f.db.select().from(schema.submissions).all();
    expect(rows).toHaveLength(0); // nothing persisted
  });

  it('persists the submission in the database with correct fields', async () => {
    await submit(f);
    const [sub] = f.db.select().from(schema.submissions).all();

    expect(sub!.leadEmail).toBe('user@test.com');
    expect(sub!.leadZip).toBe('94103');
    expect(sub!.leadName).toBe('Test User');
    expect(sub!.estimateMin).toBe(54000);
    expect(sub!.estimateMax).toBe(58000);
    expect(sub!.currency).toBe('USD');
    expect(sub!.tenantId).toBe(f.tenantId);
    expect(sub!.estimatorId).toBe(f.estimatorId);
    expect(sub!.serviceAreaValid).toBe(true); // no SA configured → all zips valid
  });

  it('tracks a submit analytics event', async () => {
    await submit(f);
    const events = f.db
      .select()
      .from(schema.analyticsEvents)
      .all();
    const submitEvent = events.find((e) => e.eventType === 'submit');
    expect(submitEvent).toBeDefined();
    expect(submitEvent!.estimatorId).toBe(f.estimatorId);
    expect(submitEvent!.sessionId).toBe('sess-abc');
  });

  it('includes addon pricing in the estimate', async () => {
    const res = await submit(f, {
      answers: { baseKey: 'pool_only', sizeKey: '15x30', addonKeys: ['salt_water', 'led_lighting'] },
    });
    const body = (await res.json()) as any;
    // 54000 + 1200 + 800 = 56000 min; 58000 + 2200 + 1500 = 61700 max
    expect(body.data.estimate.min).toBe(56000);
    expect(body.data.estimate.max).toBe(61700);
  });

  it('returns min=0 max=0 when no pricing config matches (graceful degradation)', async () => {
    const res = await submit(f, {
      answers: { baseKey: 'hot_tub', sizeKey: '10x10', addonKeys: [] },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.data.estimate.min).toBe(0);
    expect(body.data.estimate.max).toBe(0);
  });

  it('returns 400 for missing required fields', async () => {
    const res = await f.submissionApp.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estimatorPublicKey: f.publicKey }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.code).toBe('VALIDATION');
  });

  it('returns 404 for unknown publicKey', async () => {
    const res = await submit(f, { estimatorPublicKey: 'unknown-key' });
    expect(res.status).toBe(404);
  });
});

// ── Notification delivery ─────────────────────────────────────────────────────

describe('POST /submissions — notification', () => {
  it('sends notification email to configured recipients', async () => {
    const f = await setupE2E({
      notificationRecipients: ['owner@co.test', 'sales@co.test'],
    });

    await f.submissionApp.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        estimatorPublicKey: f.publicKey,
        lead: { email: 'customer@test.com', zip: '94103', name: 'Alice', phone: '555-0100' },
        answers: { baseKey: 'pool_only', sizeKey: '15x30', addonKeys: [] },
      }),
    });

    // NotificationService is async fire-and-forget but MockEmailProvider resolves immediately
    // Allow microtask queue to flush
    await new Promise((r) => setTimeout(r, 10));

    // Two recipients → two emails
    expect(f.mockEmail.sentEmails).toHaveLength(2);
    const recipients = f.mockEmail.sentEmails.map((e) => e.to);
    expect(recipients).toContain('owner@co.test');
    expect(recipients).toContain('sales@co.test');
    // Subject includes estimator title
    expect(f.mockEmail.sentEmails[0]!.subject).toContain('Pool Cost Estimator');
  });

  it('does not send notification when no recipients configured', async () => {
    const f = await setupE2E({ notificationRecipients: [] });

    await f.submissionApp.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        estimatorPublicKey: f.publicKey,
        lead: { email: 'customer@test.com', zip: '94103', name: 'Alice', phone: '555-0100' },
        answers: { baseKey: 'pool_only', sizeKey: '15x30', addonKeys: [] },
      }),
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(f.mockEmail.sentEmails).toHaveLength(0);
  });
});

// ── Service-area gating ───────────────────────────────────────────────────────

describe('POST /submissions — service area gating', () => {
  const submitTo = (f: E2EFixture, zip: string) =>
    f.submissionApp.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        estimatorPublicKey: f.publicKey,
        lead: { email: 'u@t.com', zip, name: 'Test User', phone: '555-0100' },
        answers: { baseKey: 'pool_only', sizeKey: '15x30', addonKeys: [] },
        sessionId: 'sess-gate',
      }),
    });

  it('behavior=block + served zip → 201', async () => {
    const f = await setupE2E({ serviceAreaBehavior: 'block', configureServiceArea: true });
    expect((await submitTo(f, '94103')).status).toBe(201);
  });

  it('behavior=block + unserved zip → 422 OUT_OF_AREA', async () => {
    const f = await setupE2E({ serviceAreaBehavior: 'block', configureServiceArea: true });
    const res = await submitTo(f, '99999');
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).error.code).toBe('OUT_OF_AREA');
  });

  it('behavior=block + unserved zip → gated_out analytics event tracked', async () => {
    const f = await setupE2E({ serviceAreaBehavior: 'block', configureServiceArea: true });
    await submitTo(f, '99999');
    const events = f.db.select().from(schema.analyticsEvents).all();
    expect(events.find((e) => e.eventType === 'gated_out')).toBeDefined();
  });

  it('behavior=block + unserved zip → no submission row created', async () => {
    const f = await setupE2E({ serviceAreaBehavior: 'block', configureServiceArea: true });
    await submitTo(f, '99999');
    expect(f.db.select().from(schema.submissions).all()).toHaveLength(0);
  });

  it('behavior=warn + unserved zip → 201 with serviceAreaValid=false', async () => {
    const f = await setupE2E({ serviceAreaBehavior: 'warn', configureServiceArea: true });
    const res = await submitTo(f, '99999');
    expect(res.status).toBe(201);
    const [sub] = f.db.select().from(schema.submissions).all();
    expect(sub!.serviceAreaValid).toBe(false);
  });

  it('behavior=warn + served zip → serviceAreaValid=true', async () => {
    const f = await setupE2E({ serviceAreaBehavior: 'warn', configureServiceArea: true });
    await submitTo(f, '94103');
    const [sub] = f.db.select().from(schema.submissions).all();
    expect(sub!.serviceAreaValid).toBe(true);
  });

  it('no service area configured → all zips accepted regardless of behavior', async () => {
    // configureServiceArea=false means 0 rows → unconstrained
    const f = await setupE2E({ serviceAreaBehavior: 'block', configureServiceArea: false });
    const res = await submitTo(f, '99999');
    expect(res.status).toBe(201);
    const [sub] = f.db.select().from(schema.submissions).all();
    expect(sub!.serviceAreaValid).toBe(true);
  });
});

// ── Full round-trip: GET config then POST submission ──────────────────────────

describe('full widget round-trip', () => {
  it('config from GET matches what is needed to drive POST submission', async () => {
    const f = await setupE2E();

    // Step 1: fetch widget config
    const configRes = await f.widgetApp.request(`/${f.publicKey}`);
    expect(configRes.status).toBe(200);
    const config = ((await configRes.json()) as any).data;

    // Step 2: use config fields to drive submission
    const submissionRes = await f.submissionApp.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        estimatorPublicKey: config.publicKey,        // from config
        lead: { email: 'widget@user.com', zip: '94103', name: 'Widget User', phone: '555-0100' },
        answers: {
          baseKey: config.questions[0]!.options![0], // first option of first question = 'pool_only'
          sizeKey: config.questions[1]!.options![0], // first option of second question = '15x30'
          addonKeys: [],
        },
      }),
    });

    expect(submissionRes.status).toBe(201);
    const submission = ((await submissionRes.json()) as any).data;
    expect(submission.submissionId).toBeTruthy();
    expect(submission.estimate.min).toBeGreaterThanOrEqual(0);
    expect(submission.estimate.currency).toBe('USD');

    // Confirm DB record ties back to the estimator from the config
    const [dbSub] = f.db.select().from(schema.submissions).all();
    expect(dbSub!.estimatorId).toBe(config.estimatorId);
    expect(dbSub!.leadEmail).toBe('widget@user.com');
  });
});
