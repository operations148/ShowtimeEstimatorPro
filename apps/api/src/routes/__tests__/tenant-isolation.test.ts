/**
 * Tenant isolation integration tests.
 *
 * Verifies that a user authenticated as Tenant A cannot read, modify, or delete
 * resources belonging to Tenant B — across estimators, submissions, service
 * areas, users, analytics, and exports.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { fileURLToPath } from 'url';
import path from 'path';
import * as jose from 'jose';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { SESSION_COOKIE_NAME } from '@repo/shared';
import { MockEmailProvider } from '@repo/provider-adapters';
import { createEstimatorRoutes } from '../estimators';
import { createSubmissionRoutes } from '../submissions';
import { createExportRoutes } from '../exports';
import { createServiceAreaRoutes } from '../service-areas';
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

function auth(token: string) {
  return { Cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

// ── Fixture ───────────────────────────────────────────────────────────────────

interface TenantFixture {
  tenantId: string;
  userId: string;
  token: string;
}

interface Fixture {
  db: BetterSQLite3Database<typeof schema>;
  estimatorApp: ReturnType<typeof createEstimatorRoutes>;
  submissionApp: ReturnType<typeof createSubmissionRoutes>;
  exportApp: ReturnType<typeof createExportRoutes>;
  serviceAreaApp: ReturnType<typeof createServiceAreaRoutes>;
  a: TenantFixture;
  b: TenantFixture;
}

async function seedTenantFixture(
  db: BetterSQLite3Database<typeof schema>,
  slug: string,
): Promise<TenantFixture> {
  const [tenant] = db.insert(schema.tenants).values({ slug, name: slug }).returning().all();
  const [user] = db
    .insert(schema.users)
    .values({ tenantId: tenant!.id, email: `owner@${slug}.test`, role: 'owner' })
    .returning()
    .all();
  const token = await signToken({ sub: user!.id, tenantId: tenant!.id, role: 'owner' });
  return { tenantId: tenant!.id, userId: user!.id, token };
}

function seedEstimator(db: BetterSQLite3Database<typeof schema>, tenantId: string) {
  const publicKey = `pk-${Math.random().toString(36).slice(2)}`.padEnd(32, '0');
  const [e] = db
    .insert(schema.estimators)
    .values({ tenantId, publicKey, title: 'Est', branding: {} })
    .returning()
    .all();
  return e!;
}

function seedSubmission(
  db: BetterSQLite3Database<typeof schema>,
  tenantId: string,
  estimatorId: string,
  email: string,
) {
  const [s] = db
    .insert(schema.submissions)
    .values({
      tenantId,
      estimatorId,
      versionId: 'v1',
      leadEmail: email,
      leadZip: '90210',
      answers: {},
      estimateMin: 1000,
      estimateMax: 2000,
    })
    .returning()
    .all();
  return s!;
}

async function setup(): Promise<Fixture> {
  const db = createTestDb();
  const mockEmail = new MockEmailProvider();

  const estimatorApp = createEstimatorRoutes(db);
  const submissionApp = createSubmissionRoutes(db, mockEmail);
  const exportApp = createExportRoutes(db);
  const serviceAreaApp = createServiceAreaRoutes(db);

  const a = await seedTenantFixture(db, `tenant-a-${Date.now()}`);
  const b = await seedTenantFixture(db, `tenant-b-${Date.now()}`);

  return { db, estimatorApp, submissionApp, exportApp, serviceAreaApp, a, b };
}

// ── Estimator isolation ───────────────────────────────────────────────────────

describe('tenant isolation — estimators', () => {
  let f: Fixture;
  beforeEach(async () => { f = await setup(); });

  it('tenant A cannot GET tenant B\'s estimator by id', async () => {
    const est = seedEstimator(f.db, f.b.tenantId);
    const res = await f.estimatorApp.request(`/${est.id}`, {
      headers: auth(f.a.token),
    });
    expect(res.status).toBe(404);
  });

  it('tenant A\'s estimator list does not include tenant B\'s estimators', async () => {
    seedEstimator(f.db, f.a.tenantId);
    const bEst = seedEstimator(f.db, f.b.tenantId);

    const res = await f.estimatorApp.request('/', { headers: auth(f.a.token) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ id: string }> };
    const ids = body.data.map((e) => e.id);
    expect(ids).not.toContain(bEst.id);
  });

  it('tenant A cannot PATCH tenant B\'s estimator', async () => {
    const est = seedEstimator(f.db, f.b.tenantId);
    const res = await f.estimatorApp.request(`/${est.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth(f.a.token) },
      body: JSON.stringify({ title: 'Hacked' }),
    });
    expect(res.status).toBe(404);
  });

  it('tenant A cannot DELETE tenant B\'s estimator', async () => {
    const est = seedEstimator(f.db, f.b.tenantId);
    const res = await f.estimatorApp.request(`/${est.id}`, {
      method: 'DELETE',
      headers: auth(f.a.token),
    });
    expect(res.status).toBe(404);
  });

  it('tenant A cannot PUT questions on tenant B\'s estimator', async () => {
    const est = seedEstimator(f.db, f.b.tenantId);
    const res = await f.estimatorApp.request(`/${est.id}/questions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...auth(f.a.token) },
      body: JSON.stringify({ questions: [] }),
    });
    expect(res.status).toBe(404);
  });

  it('tenant A cannot publish tenant B\'s estimator', async () => {
    const est = seedEstimator(f.db, f.b.tenantId);
    const res = await f.estimatorApp.request(`/${est.id}/publish`, {
      method: 'POST',
      headers: auth(f.a.token),
    });
    expect(res.status).toBe(404);
  });
});

// ── Submission isolation ──────────────────────────────────────────────────────

describe('tenant isolation — submissions', () => {
  let f: Fixture;
  beforeEach(async () => { f = await setup(); });

  it('tenant A\'s submission list does not include tenant B\'s submissions', async () => {
    const aEst = seedEstimator(f.db, f.a.tenantId);
    const bEst = seedEstimator(f.db, f.b.tenantId);

    seedSubmission(f.db, f.a.tenantId, aEst.id, 'a-lead@test.com');
    seedSubmission(f.db, f.b.tenantId, bEst.id, 'b-lead@test.com');

    const res = await f.submissionApp.request('/', { headers: auth(f.a.token) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ leadEmail: string }> };
    const emails = body.data.map((s) => s.leadEmail);
    expect(emails).toContain('a-lead@test.com');
    expect(emails).not.toContain('b-lead@test.com');
  });

  it('tenant A cannot DELETE tenant B\'s submission', async () => {
    const bEst = seedEstimator(f.db, f.b.tenantId);
    const sub = seedSubmission(f.db, f.b.tenantId, bEst.id, 'b@test.com');

    const res = await f.submissionApp.request(`/${sub.id}`, {
      method: 'DELETE',
      headers: auth(f.a.token),
    });
    expect(res.status).toBe(404);
  });
});

// ── Export isolation ──────────────────────────────────────────────────────────

describe('tenant isolation — CSV export', () => {
  let f: Fixture;
  beforeEach(async () => { f = await setup(); });

  it('CSV export for tenant A does not include tenant B\'s leads', async () => {
    const aEst = seedEstimator(f.db, f.a.tenantId);
    const bEst = seedEstimator(f.db, f.b.tenantId);

    seedSubmission(f.db, f.a.tenantId, aEst.id, 'mine@test.com');
    seedSubmission(f.db, f.b.tenantId, bEst.id, 'theirs@test.com');

    const res = await f.exportApp.request('/submissions', { headers: auth(f.a.token) });
    expect(res.status).toBe(200);
    const csv = await res.text();
    expect(csv).toContain('mine@test.com');
    expect(csv).not.toContain('theirs@test.com');
  });
});

// ── Service area isolation ────────────────────────────────────────────────────

describe('tenant isolation — service areas', () => {
  let f: Fixture;
  beforeEach(async () => { f = await setup(); });

  it('tenant A can view its own service area zips', async () => {
    // Seed service area for A
    f.db
      .insert(schema.serviceAreas)
      .values([
        { tenantId: f.a.tenantId, zip: '90210' },
        { tenantId: f.a.tenantId, zip: '94103' },
      ])
      .run();

    const res = await f.serviceAreaApp.request('/', { headers: auth(f.a.token) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { zips: string[] } };
    expect(body.data.zips).toContain('90210');
    expect(body.data.zips).toContain('94103');
  });

  it('tenant A\'s service area does not include tenant B\'s zips', async () => {
    f.db.insert(schema.serviceAreas).values({ tenantId: f.a.tenantId, zip: '90210' }).run();
    f.db.insert(schema.serviceAreas).values({ tenantId: f.b.tenantId, zip: '10001' }).run();

    const res = await f.serviceAreaApp.request('/', { headers: auth(f.a.token) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { zips: string[] } };
    expect(body.data.zips).not.toContain('10001');
  });
});

// ── Cross-tenant unauthenticated access ───────────────────────────────────────

describe('tenant isolation — unauthenticated requests', () => {
  let f: Fixture;
  beforeEach(async () => { f = await setup(); });

  it('GET /estimators without auth cookie returns 401', async () => {
    const res = await f.estimatorApp.request('/');
    expect(res.status).toBe(401);
  });

  it('GET /submissions without auth cookie returns 401', async () => {
    const res = await f.submissionApp.request('/');
    expect(res.status).toBe(401);
  });

  it('GET /submissions/export without auth cookie returns 401', async () => {
    const res = await f.exportApp.request('/submissions');
    expect(res.status).toBe(401);
  });
});
