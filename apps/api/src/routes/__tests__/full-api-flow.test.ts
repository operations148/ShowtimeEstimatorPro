/**
 * Full API integration test: exercises the complete lifecycle via HTTP calls.
 *
 * Flow under test:
 *   1. Seed tenant + owner (direct DB, then sign JWT — mirrors signup)
 *   2. POST /estimators           → create estimator
 *   3. PUT  /estimators/:id/questions   → add questions
 *   4. PUT  /estimators/:id/pricing → add pricing config
 *   5. POST /estimators/:id/publish → publish
 *   6. GET  /widget/:publicKey     → verify widget config visible to widget
 *   7. POST /submissions           → submit as end-user
 *   8. Verify submission persisted in DB
 *   9. GET  /submissions (dashboard) → appears in list
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { fileURLToPath } from 'url';
import path from 'path';
import * as jose from 'jose';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { MockEmailProvider } from '@repo/provider-adapters';
import { SESSION_COOKIE_NAME, SUBSCRIPTION_PLAN_ID } from '@repo/shared';
import { createEstimatorRoutes } from '../estimators';
import { createWidgetRoutes } from '../widget';
import { createSubmissionRoutes } from '../submissions';
import { createExportRoutes } from '../exports';
import * as schema from '../../models/schema';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_FOLDER = path.resolve(__dirname, '../../../drizzle');

const TEST_SECRET = 'test-secret-for-integration-tests-minimum-32-chars!!';

function createTestDb(): BetterSQLite3Database<typeof schema> {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

async function signToken(payload: { sub: string; tenantId: string; role: string }) {
  const secret = new TextEncoder().encode(TEST_SECRET);
  return new jose.SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .setIssuedAt()
    .sign(secret);
}

function authCookie(token: string) {
  return { Cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

const SAMPLE_QUESTIONS = [
  {
    id: 'pool_type',
    stepId: 'pool_type',
    type: 'single',
    label: 'Pool type',
    options: ['pool_only', 'pool_spa'],
    required: true,
    order: 0,
  },
  {
    id: 'pool_size',
    stepId: 'pool_size',
    type: 'single',
    label: 'Pool size',
    options: ['15x30', '20x40'],
    required: true,
    order: 1,
  },
];

const SAMPLE_PRICING = {
  currency: 'USD',
  base: { pool_only: { '15x30': [54000, 58000], '20x40': [72000, 80000] } },
  addons: { salt_water: [1200, 2200] },
  minMaxMode: 'sum_ranges',
};

// ── Fixture ───────────────────────────────────────────────────────────────────

interface Fixture {
  db: BetterSQLite3Database<typeof schema>;
  estimatorApp: ReturnType<typeof createEstimatorRoutes>;
  widgetApp: ReturnType<typeof createWidgetRoutes>;
  submissionApp: ReturnType<typeof createSubmissionRoutes>;
  exportApp: ReturnType<typeof createExportRoutes>;
  mockEmail: MockEmailProvider;
  tenantId: string;
  userId: string;
  ownerToken: string;
}

async function setup(): Promise<Fixture> {
  const db = createTestDb();
  const mockEmail = new MockEmailProvider();

  const estimatorApp = createEstimatorRoutes(db);
  const widgetApp = createWidgetRoutes(db);
  const submissionApp = createSubmissionRoutes(db, mockEmail);
  const exportApp = createExportRoutes(db);

  const [tenant] = db
    .insert(schema.tenants)
    .values({ slug: 'flow-test', name: 'Flow Test Co' })
    .returning()
    .all();

  const [user] = db
    .insert(schema.users)
    .values({ tenantId: tenant!.id, email: 'owner@flow.test', role: 'owner' })
    .returning()
    .all();

  const ownerToken = await signToken({ sub: user!.id, tenantId: tenant!.id, role: 'owner' });

  return {
    db,
    estimatorApp,
    widgetApp,
    submissionApp,
    exportApp,
    mockEmail,
    tenantId: tenant!.id,
    userId: user!.id,
    ownerToken,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('full API lifecycle flow', () => {
  let f: Fixture;
  beforeEach(async () => { f = await setup(); });

  it('creates an estimator via POST /estimators', async () => {
    const res = await f.estimatorApp.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authCookie(f.ownerToken) },
      body: JSON.stringify({ title: 'Pool Cost Estimator' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { id: string; title: string } };
    expect(body.data.title).toBe('Pool Cost Estimator');
  });

  it('adds questions to the estimator draft via PUT /estimators/:id/questions', async () => {
    const createRes = await f.estimatorApp.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authCookie(f.ownerToken) },
      body: JSON.stringify({ title: 'Est' }),
    });
    const { data: est } = (await createRes.json()) as { data: { id: string } };

    const res = await f.estimatorApp.request(`/${est.id}/questions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authCookie(f.ownerToken) },
      body: JSON.stringify({ questions: SAMPLE_QUESTIONS }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { questions: unknown[] } };
    expect(body.data.questions).toHaveLength(2);
  });

  it('adds pricing config via PUT /estimators/:id/pricing', async () => {
    const createRes = await f.estimatorApp.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authCookie(f.ownerToken) },
      body: JSON.stringify({ title: 'Est' }),
    });
    const { data: est } = (await createRes.json()) as { data: { id: string } };

    const res = await f.estimatorApp.request(`/${est.id}/pricing`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authCookie(f.ownerToken) },
      body: JSON.stringify(SAMPLE_PRICING),
    });
    expect(res.status).toBe(200);
  });

  it('publishes the estimator via POST /estimators/:id/publish', async () => {
    const createRes = await f.estimatorApp.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authCookie(f.ownerToken) },
      body: JSON.stringify({ title: 'Est' }),
    });
    const { data: est } = (await createRes.json()) as { data: { id: string } };

    const res = await f.estimatorApp.request(`/${est.id}/publish`, {
      method: 'POST',
      headers: { ...authCookie(f.ownerToken) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { status: string } };
    expect(body.data.status).toBe('published');
  });

  it('full flow: create → questions → pricing → publish → widget config → submit → verify DB', async () => {
    // Step 1: create estimator
    const createRes = await f.estimatorApp.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authCookie(f.ownerToken) },
      body: JSON.stringify({ title: 'Pool Cost Estimator' }),
    });
    expect(createRes.status).toBe(201);
    const { data: est } = (await createRes.json()) as { data: { id: string; publicKey: string } };

    // Step 2: add questions
    const qRes = await f.estimatorApp.request(`/${est.id}/questions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authCookie(f.ownerToken) },
      body: JSON.stringify({ questions: SAMPLE_QUESTIONS }),
    });
    expect(qRes.status).toBe(200);

    // Step 3: add pricing config
    const pRes = await f.estimatorApp.request(`/${est.id}/pricing`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authCookie(f.ownerToken) },
      body: JSON.stringify(SAMPLE_PRICING),
    });
    expect(pRes.status).toBe(200);

    // Step 4: publish
    const pubRes = await f.estimatorApp.request(`/${est.id}/publish`, {
      method: 'POST',
      headers: { ...authCookie(f.ownerToken) },
    });
    expect(pubRes.status).toBe(200);

    // Step 5: widget config visible
    const widgetRes = await f.widgetApp.request(`/${est.publicKey}`);
    expect(widgetRes.status).toBe(200);
    const { data: config } = (await widgetRes.json()) as {
      data: { questions: unknown[]; estimatorId: string };
    };
    expect(config.questions).toHaveLength(2);
    expect(config.estimatorId).toBe(est.id);

    // Step 6: submit via widget API
    const submitRes = await f.submissionApp.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        estimatorPublicKey: est.publicKey,
        lead: { email: 'customer@test.com', zip: '90210', name: 'Alice', phone: '555-0100' },
        answers: { pool_type: 'pool_only', pool_size: '15x30' },
      }),
    });
    expect(submitRes.status).toBe(201);
    const submitBody = (await submitRes.json()) as {
      data: { submissionId: string; estimate: { min: number; max: number; currency: string } };
    };
    expect(submitBody.data.estimate.min).toBe(54000);
    expect(submitBody.data.estimate.max).toBe(58000);

    // Step 7: verify submission persisted in DB
    const rows = f.db
      .select()
      .from(schema.submissions)
      .where(eq(schema.submissions.tenantId, f.tenantId))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.leadEmail).toBe('customer@test.com');
    expect(rows[0]!.leadName).toBe('Alice');
    expect(rows[0]!.estimateMin).toBe(54000);
    expect(rows[0]!.estimateMax).toBe(58000);

    // Step 8: verify submission appears in dashboard list
    const listRes = await f.submissionApp.request('/', {
      headers: authCookie(f.ownerToken),
    });
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { data: Array<{ leadEmail: string }> };
    expect(listBody.data[0]?.leadEmail).toBe('customer@test.com');
  });

  it('notification email is sent to tenant owner after submission', async () => {
    // Set up tenant with notification recipient
    f.db
      .update(schema.tenants)
      .set({ notificationRecipients: ['alerts@flow.test'] })
      .where(eq(schema.tenants.id, f.tenantId))
      .run();

    // Create + publish estimator
    const createRes = await f.estimatorApp.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authCookie(f.ownerToken) },
      body: JSON.stringify({ title: 'Notif Est' }),
    });
    const { data: est } = (await createRes.json()) as { data: { id: string; publicKey: string } };
    await f.estimatorApp.request(`/${est.id}/questions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authCookie(f.ownerToken) },
      body: JSON.stringify({ questions: SAMPLE_QUESTIONS }),
    });
    await f.estimatorApp.request(`/${est.id}/publish`, {
      method: 'POST',
      headers: authCookie(f.ownerToken),
    });

    f.mockEmail.sentEmails.length = 0;

    await f.submissionApp.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        estimatorPublicKey: est.publicKey,
        lead: { email: 'lead@test.com', zip: '90210', name: 'Lead Tester', phone: '555-0100' },
        answers: { pool_type: 'pool_only', pool_size: '15x30' },
      }),
    });

    const sent = f.mockEmail.sentEmails;
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe('alerts@flow.test');
  });

  it('export includes submitted lead after full flow', async () => {
    // Create + publish
    const createRes = await f.estimatorApp.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authCookie(f.ownerToken) },
      body: JSON.stringify({ title: 'Export Est' }),
    });
    const { data: est } = (await createRes.json()) as { data: { id: string; publicKey: string } };
    await f.estimatorApp.request(`/${est.id}/questions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authCookie(f.ownerToken) },
      body: JSON.stringify({ questions: SAMPLE_QUESTIONS }),
    });
    await f.estimatorApp.request(`/${est.id}/publish`, {
      method: 'POST',
      headers: authCookie(f.ownerToken),
    });

    // Submit
    await f.submissionApp.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        estimatorPublicKey: est.publicKey,
        lead: { email: 'export-lead@test.com', zip: '90210', name: 'Export Lead', phone: '555-0100' },
        answers: { pool_type: 'pool_only', pool_size: '15x30' },
      }),
    });

    // Export CSV
    const exportRes = await f.exportApp.request('/submissions', {
      headers: authCookie(f.ownerToken),
    });
    expect(exportRes.status).toBe(200);
    const csv = await exportRes.text();
    expect(csv).toContain('export-lead@test.com');
  });
});

// ── Billing enforcement ───────────────────────────────────────────────────────
// Note: comprehensive billing enforcement tests already live in
// billing-subscription.test.ts. These tests verify the cross-concern behaviour
// with the estimator route factory specifically.

describe('billing enforcement — estimator routes', () => {
  let f: Fixture;
  beforeEach(async () => { f = await setup(); });

  function seedSubscription(status: 'past_due' | 'canceled' | 'unpaid') {
    f.db
      .insert(schema.subscriptions)
      .values({
        tenantId: f.tenantId,
        externalId: `sub_${Date.now()}`,
        status,
        planId: SUBSCRIPTION_PLAN_ID,
        currentPeriodEnd: new Date(Date.now() + 86400_000),
      })
      .run();
  }

  it('past_due subscription → POST /estimators returns 402', async () => {
    seedSubscription('past_due');
    const res = await f.estimatorApp.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authCookie(f.ownerToken) },
      body: JSON.stringify({ title: 'Should fail' }),
    });
    expect(res.status).toBe(402);
  });

  it('past_due subscription → GET /estimators still returns 200', async () => {
    seedSubscription('past_due');
    const res = await f.estimatorApp.request('/', {
      headers: authCookie(f.ownerToken),
    });
    expect(res.status).toBe(200);
  });

  it('canceled subscription → POST /estimators returns 402', async () => {
    seedSubscription('canceled');
    const res = await f.estimatorApp.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authCookie(f.ownerToken) },
      body: JSON.stringify({ title: 'Should fail' }),
    });
    expect(res.status).toBe(402);
  });

  it('no subscription → all routes still work (no subscription = allowed)', async () => {
    const res = await f.estimatorApp.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authCookie(f.ownerToken) },
      body: JSON.stringify({ title: 'No sub required' }),
    });
    expect(res.status).toBe(201);
  });
});
