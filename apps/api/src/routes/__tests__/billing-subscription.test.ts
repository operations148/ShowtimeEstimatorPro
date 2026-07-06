import { describe, it, expect, beforeEach } from 'vitest';
import { fileURLToPath } from 'url';
import path from 'path';
import * as jose from 'jose';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { SESSION_COOKIE_NAME, SUBSCRIPTION_PLAN_ID } from '@repo/shared';
import { MockPaymentProvider } from '@repo/provider-adapters';
import { createBillingRoutes } from '../billing';
import { createEstimatorRoutes } from '../estimators';
import { createUserRoutes } from '../users';
import { createExportRoutes } from '../exports';
import { createDevRoutes } from '../dev';
import * as schema from '../../models/schema';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_FOLDER = path.resolve(__dirname, '../../../drizzle');

// ── Helpers ───────────────────────────────────────────────────────────────────

function createTestDb(): BetterSQLite3Database<typeof schema> {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

const TEST_SECRET = 'test-secret-for-integration-tests-minimum-32-chars!!';

async function signToken(payload: { sub: string; tenantId: string; role: string }): Promise<string> {
  const secret = new TextEncoder().encode(TEST_SECRET);
  return new jose.SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .setIssuedAt()
    .sign(secret);
}

function authHeader(token: string) {
  return { Cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

function seedTenant(db: BetterSQLite3Database<typeof schema>, slug: string) {
  const [t] = db.insert(schema.tenants).values({ slug, name: slug }).returning().all();
  return t!;
}

function seedUser(
  db: BetterSQLite3Database<typeof schema>,
  tenantId: string,
  role: 'owner' | 'admin' | 'member' = 'owner',
) {
  const [u] = db
    .insert(schema.users)
    .values({ tenantId, email: `u-${Math.random()}@test.com`, role })
    .returning()
    .all();
  return u!;
}

function seedEstimator(db: BetterSQLite3Database<typeof schema>, tenantId: string) {
  const publicKey = Math.random().toString(36).slice(2).padEnd(32, 'x');
  const [e] = db
    .insert(schema.estimators)
    .values({ tenantId, publicKey, title: 'Test', branding: {} })
    .returning()
    .all();
  return e!;
}

function seedSubscription(
  db: BetterSQLite3Database<typeof schema>,
  tenantId: string,
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid',
) {
  db.insert(schema.subscriptions)
    .values({
      tenantId,
      externalId: `sub_${Math.random()}`,
      status,
      planId: SUBSCRIPTION_PLAN_ID,
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    })
    .run();
}

// ── Shared fixture builder ────────────────────────────────────────────────────

interface Fixtures {
  db: BetterSQLite3Database<typeof schema>;
  tenantId: string;
  userId: string;
  token: string;
  estimatorApp: ReturnType<typeof createEstimatorRoutes>;
  userApp: ReturnType<typeof createUserRoutes>;
}

async function buildFixtures(slug: string): Promise<Fixtures> {
  const db = createTestDb();
  const tenant = seedTenant(db, slug);
  const user = seedUser(db, tenant.id);
  const token = await signToken({ sub: user.id, tenantId: tenant.id, role: 'owner' });
  return {
    db,
    tenantId: tenant.id,
    userId: user.id,
    token,
    estimatorApp: createEstimatorRoutes(db),
    userApp: createUserRoutes(db),
  };
}

// ── Subscription enforcement — estimator routes ───────────────────────────────

describe('subscription enforcement on estimator routes', () => {
  it('no subscription → GET allowed', async () => {
    const f = await buildFixtures('no-sub-get');
    const res = await f.estimatorApp.request('/', { headers: authHeader(f.token) });
    expect(res.status).toBe(200);
  });

  it('no subscription → POST allowed', async () => {
    const f = await buildFixtures('no-sub-post');
    const res = await f.estimatorApp.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(f.token) },
      body: JSON.stringify({ title: 'Test', branding: {} }),
    });
    expect(res.status).toBe(201);
  });

  it('active → GET allowed', async () => {
    const f = await buildFixtures('active-get');
    seedSubscription(f.db, f.tenantId, 'active');
    const res = await f.estimatorApp.request('/', { headers: authHeader(f.token) });
    expect(res.status).toBe(200);
  });

  it('active → POST allowed', async () => {
    const f = await buildFixtures('active-post');
    seedSubscription(f.db, f.tenantId, 'active');
    const res = await f.estimatorApp.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(f.token) },
      body: JSON.stringify({ title: 'Test', branding: {} }),
    });
    expect(res.status).toBe(201);
  });

  it('trialing → GET allowed', async () => {
    const f = await buildFixtures('trial-get');
    seedSubscription(f.db, f.tenantId, 'trialing');
    const res = await f.estimatorApp.request('/', { headers: authHeader(f.token) });
    expect(res.status).toBe(200);
  });

  it('trialing → POST allowed', async () => {
    const f = await buildFixtures('trial-post');
    seedSubscription(f.db, f.tenantId, 'trialing');
    const res = await f.estimatorApp.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(f.token) },
      body: JSON.stringify({ title: 'Test', branding: {} }),
    });
    expect(res.status).toBe(201);
  });

  it('past_due → GET allowed', async () => {
    const f = await buildFixtures('past-due-get');
    seedSubscription(f.db, f.tenantId, 'past_due');
    const res = await f.estimatorApp.request('/', { headers: authHeader(f.token) });
    expect(res.status).toBe(200);
  });

  it('past_due → POST blocked with 402', async () => {
    const f = await buildFixtures('past-due-post');
    seedSubscription(f.db, f.tenantId, 'past_due');
    const res = await f.estimatorApp.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(f.token) },
      body: JSON.stringify({ title: 'Test', branding: {} }),
    });
    expect(res.status).toBe(402);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('PAYMENT_REQUIRED');
  });

  it('past_due → PATCH blocked with 402', async () => {
    const f = await buildFixtures('past-due-patch');
    seedSubscription(f.db, f.tenantId, 'past_due');
    const est = seedEstimator(f.db, f.tenantId);
    const res = await f.estimatorApp.request(`/${est.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader(f.token) },
      body: JSON.stringify({ title: 'Updated' }),
    });
    expect(res.status).toBe(402);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('PAYMENT_REQUIRED');
  });

  it('past_due → DELETE blocked with 402', async () => {
    const f = await buildFixtures('past-due-delete');
    seedSubscription(f.db, f.tenantId, 'past_due');
    const est = seedEstimator(f.db, f.tenantId);
    const res = await f.estimatorApp.request(`/${est.id}`, {
      method: 'DELETE',
      headers: authHeader(f.token),
    });
    expect(res.status).toBe(402);
  });

  it('canceled → GET blocked with 402', async () => {
    const f = await buildFixtures('canceled-get');
    seedSubscription(f.db, f.tenantId, 'canceled');
    const res = await f.estimatorApp.request('/', { headers: authHeader(f.token) });
    expect(res.status).toBe(402);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('PAYMENT_REQUIRED');
  });

  it('canceled → POST blocked with 402', async () => {
    const f = await buildFixtures('canceled-post');
    seedSubscription(f.db, f.tenantId, 'canceled');
    const res = await f.estimatorApp.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(f.token) },
      body: JSON.stringify({ title: 'Test', branding: {} }),
    });
    expect(res.status).toBe(402);
  });

  it('unpaid → GET blocked with 402', async () => {
    const f = await buildFixtures('unpaid-get');
    seedSubscription(f.db, f.tenantId, 'unpaid');
    const res = await f.estimatorApp.request('/', { headers: authHeader(f.token) });
    expect(res.status).toBe(402);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('PAYMENT_REQUIRED');
  });

  it('unpaid → POST blocked with 402', async () => {
    const f = await buildFixtures('unpaid-post');
    seedSubscription(f.db, f.tenantId, 'unpaid');
    const res = await f.estimatorApp.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(f.token) },
      body: JSON.stringify({ title: 'Test', branding: {} }),
    });
    expect(res.status).toBe(402);
  });

  it('error message for past_due mentions read-only', async () => {
    const f = await buildFixtures('past-due-msg');
    seedSubscription(f.db, f.tenantId, 'past_due');
    const res = await f.estimatorApp.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(f.token) },
      body: JSON.stringify({ title: 'Test', branding: {} }),
    });
    const body = (await res.json()) as any;
    expect(body.error.message).toMatch(/read-only/i);
  });

  it('different tenant subscriptions are isolated', async () => {
    const f = await buildFixtures('iso-a');
    // Tenant A has a canceled subscription
    seedSubscription(f.db, f.tenantId, 'canceled');

    // Tenant B's state must not affect tenant A's middleware
    const tenantB = seedTenant(f.db, 'iso-b');
    const userB = seedUser(f.db, tenantB.id);
    seedSubscription(f.db, tenantB.id, 'active');
    const tokenB = await signToken({ sub: userB.id, tenantId: tenantB.id, role: 'owner' });

    const estApp = createEstimatorRoutes(f.db);

    // Tenant A (canceled) → 402
    const resA = await estApp.request('/', { headers: authHeader(f.token) });
    expect(resA.status).toBe(402);

    // Tenant B (active) → 200
    const resB = await estApp.request('/', { headers: authHeader(tokenB) });
    expect(resB.status).toBe(200);
  });
});

// ── Subscription enforcement — user routes ────────────────────────────────────

describe('subscription enforcement on user routes', () => {
  it('past_due → GET / allowed', async () => {
    const f = await buildFixtures('user-pd-get');
    seedSubscription(f.db, f.tenantId, 'past_due');
    const res = await f.userApp.request('/', { headers: authHeader(f.token) });
    expect(res.status).toBe(200);
  });

  it('past_due → POST / blocked with 402', async () => {
    const f = await buildFixtures('user-pd-post');
    seedSubscription(f.db, f.tenantId, 'past_due');
    const res = await f.userApp.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(f.token) },
      body: JSON.stringify({ email: 'new@test.com', role: 'member' }),
    });
    expect(res.status).toBe(402);
  });

  it('canceled → GET / blocked with 402', async () => {
    const f = await buildFixtures('user-can-get');
    seedSubscription(f.db, f.tenantId, 'canceled');
    const res = await f.userApp.request('/', { headers: authHeader(f.token) });
    expect(res.status).toBe(402);
  });
});

// ── Subscription enforcement — export routes ──────────────────────────────────

describe('subscription enforcement on export routes', () => {
  it('past_due → GET /submissions allowed', async () => {
    const f = await buildFixtures('exp-pd-get');
    seedSubscription(f.db, f.tenantId, 'past_due');
    const exportApp = createExportRoutes(f.db);
    const res = await exportApp.request('/submissions', { headers: authHeader(f.token) });
    expect(res.status).toBe(200); // CSV with just header
  });

  it('canceled → GET /submissions blocked with 402', async () => {
    const f = await buildFixtures('exp-can-get');
    seedSubscription(f.db, f.tenantId, 'canceled');
    const exportApp = createExportRoutes(f.db);
    const res = await exportApp.request('/submissions', { headers: authHeader(f.token) });
    expect(res.status).toBe(402);
  });
});

// ── Billing routes ────────────────────────────────────────────────────────────

describe('billing routes', () => {
  let db: BetterSQLite3Database<typeof schema>;
  let billingApp: ReturnType<typeof createBillingRoutes>;
  let mockPayment: MockPaymentProvider;
  let tenantId: string;
  let token: string;

  beforeEach(async () => {
    db = createTestDb();
    mockPayment = new MockPaymentProvider();
    billingApp = createBillingRoutes(db, mockPayment);

    const tenant = seedTenant(db, 'billing-' + Date.now());
    tenantId = tenant.id;
    const user = seedUser(db, tenantId);
    token = await signToken({ sub: user.id, tenantId, role: 'owner' });
  });

  describe('GET /subscription', () => {
    it('returns null when no subscription exists', async () => {
      const res = await billingApp.request('/subscription', { headers: authHeader(token) });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.data).toBeNull();
    });

    it('returns subscription when one exists', async () => {
      seedSubscription(db, tenantId, 'active');
      const res = await billingApp.request('/subscription', { headers: authHeader(token) });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.data.status).toBe('active');
      expect(body.data.tenantId).toBe(tenantId);
    });

    it('unauthenticated → 401', async () => {
      const res = await billingApp.request('/subscription');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /checkout', () => {
    it('returns a checkout URL', async () => {
      const res = await billingApp.request('/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(token) },
        body: JSON.stringify({ email: 'owner@test.com' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(typeof body.data.checkoutUrl).toBe('string');
      expect(body.data.checkoutUrl.length).toBeGreaterThan(0);
    });

    it('unauthenticated → 401', async () => {
      const res = await billingApp.request('/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'x@test.com' }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /portal', () => {
    it('returns 404 when no subscription exists', async () => {
      const res = await billingApp.request('/portal', {
        method: 'POST',
        headers: authHeader(token),
      });
      expect(res.status).toBe(404);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('NO_SUBSCRIPTION');
    });

    it('returns portal URL when subscription exists', async () => {
      seedSubscription(db, tenantId, 'active');
      const res = await billingApp.request('/portal', {
        method: 'POST',
        headers: authHeader(token),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(typeof body.data.portalUrl).toBe('string');
    });
  });

  describe('POST /webhook', () => {
    it('subscription.created with tenantId → inserts subscription row', async () => {
      const event = {
        type: 'subscription.created',
        data: {
          subscriptionId: 'sub_test_001',
          status: 'active',
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          tenantId,
          planId: SUBSCRIPTION_PLAN_ID,
        },
      };

      const res = await billingApp.request('/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.data.received).toBe(true);

      const rows = db.select().from(schema.subscriptions).all();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.externalId).toBe('sub_test_001');
      expect(rows[0]!.status).toBe('active');
      expect(rows[0]!.tenantId).toBe(tenantId);
    });

    it('subscription.created without tenantId → skips insert gracefully', async () => {
      const event = {
        type: 'subscription.created',
        data: {
          subscriptionId: 'sub_no_tenant',
          status: 'active',
          currentPeriodEnd: new Date().toISOString(),
          // no tenantId
        },
      };

      const res = await billingApp.request('/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      });
      expect(res.status).toBe(200);
      const rows = db.select().from(schema.subscriptions).all();
      expect(rows).toHaveLength(0);
    });

    it('subscription.updated → changes status in DB', async () => {
      seedSubscription(db, tenantId, 'active');
      const [existing] = db.select().from(schema.subscriptions).all();

      const event = {
        type: 'subscription.updated',
        data: {
          subscriptionId: existing!.externalId,
          status: 'past_due',
          currentPeriodEnd: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
        },
      };

      const res = await billingApp.request('/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      });
      expect(res.status).toBe(200);

      const [updated] = db.select().from(schema.subscriptions).all();
      expect(updated!.status).toBe('past_due');
    });

    it('subscription.deleted → sets status to canceled', async () => {
      seedSubscription(db, tenantId, 'active');
      const [existing] = db.select().from(schema.subscriptions).all();

      const event = {
        type: 'subscription.deleted',
        data: {
          subscriptionId: existing!.externalId,
          status: 'canceled',
          currentPeriodEnd: new Date().toISOString(),
        },
      };

      const res = await billingApp.request('/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      });
      expect(res.status).toBe(200);

      const [updated] = db.select().from(schema.subscriptions).all();
      expect(updated!.status).toBe('canceled');
    });

    it('unknown event type → 200 and no-op', async () => {
      const event = {
        type: 'invoice.paid',
        data: { subscriptionId: 'sub_x', status: 'active', currentPeriodEnd: new Date().toISOString() },
      };

      const res = await billingApp.request('/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      });
      expect(res.status).toBe(200);
      const rows = db.select().from(schema.subscriptions).all();
      expect(rows).toHaveLength(0);
    });

    it('subscription.created upserts on re-delivery', async () => {
      const externalId = 'sub_dupe';
      // First delivery
      const event = {
        type: 'subscription.created',
        data: {
          subscriptionId: externalId,
          status: 'trialing',
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          tenantId,
          planId: SUBSCRIPTION_PLAN_ID,
        },
      };
      await billingApp.request('/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
      });

      // Re-delivery with updated status
      const event2 = { ...event, data: { ...event.data, status: 'active' } };
      await billingApp.request('/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event2),
      });

      const rows = db.select().from(schema.subscriptions).all();
      expect(rows).toHaveLength(1); // no duplicate
      expect(rows[0]!.status).toBe('active');
    });
  });
});

// ── Dev simulate-webhook route ────────────────────────────────────────────────

describe('POST /dev/simulate-webhook', () => {
  let db: BetterSQLite3Database<typeof schema>;
  let devApp: ReturnType<typeof createDevRoutes>;
  let tenantId: string;

  beforeEach(() => {
    db = createTestDb();
    devApp = createDevRoutes(db);
    const tenant = seedTenant(db, 'dev-sim-' + Date.now());
    tenantId = tenant.id;
  });

  it('creates a new subscription for a tenant with no existing row', async () => {
    const res = await devApp.request('/simulate-webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, status: 'active' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.status).toBe('active');
    expect(body.data.tenantId).toBe(tenantId);

    const rows = db.select().from(schema.subscriptions).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('active');
  });

  it('updates an existing subscription status', async () => {
    seedSubscription(db, tenantId, 'active');

    const res = await devApp.request('/simulate-webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, status: 'past_due' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.status).toBe('past_due');

    const rows = db.select().from(schema.subscriptions).all();
    expect(rows).toHaveLength(1); // no duplicate
  });

  it('supports all valid statuses', async () => {
    const statuses = ['active', 'trialing', 'past_due', 'canceled', 'unpaid'] as const;
    for (const status of statuses) {
      const res = await devApp.request('/simulate-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, status }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.data.status).toBe(status);
    }
  });

  it('invalid status → 400', async () => {
    const res = await devApp.request('/simulate-webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, status: 'unknown' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('VALIDATION');
  });

  it('non-UUID tenantId → 400', async () => {
    const res = await devApp.request('/simulate-webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId: 'not-a-uuid', status: 'active' }),
    });
    expect(res.status).toBe(400);
  });
});
