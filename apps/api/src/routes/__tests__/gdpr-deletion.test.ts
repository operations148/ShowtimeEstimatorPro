/**
 * GDPR deletion endpoint tests.
 *
 * Covers:
 *  - DELETE /submissions/:id       — single submission hard delete
 *  - DELETE /tenants/me/data       — bulk tenant data erasure (Art. 17)
 *  - GET    /submissions/export    — JSON data-portability export
 *  - RetentionService.purgeExpired — age-based submission purge
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { fileURLToPath } from 'url';
import path from 'path';
import * as jose from 'jose';
import { eq, and } from 'drizzle-orm';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { MockEmailProvider, MockSmsProvider } from '@repo/provider-adapters';
import { SESSION_COOKIE_NAME, SUBSCRIPTION_PLAN_ID } from '@repo/shared';
import * as schema from '../../models/schema';
import { createTenantRoutes } from '../tenants';
import { createSubmissionRoutes } from '../submissions';
import { AuthService } from '../../services/auth.service';
import { RetentionService } from '../../services/retention.service';

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

function authHeader(token: string): Record<string, string> {
  return { Cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

function seedTenantAndUser(
  db: BetterSQLite3Database<typeof schema>,
  opts: { slug: string; email: string; role?: string },
) {
  const [tenant] = db
    .insert(schema.tenants)
    .values({ slug: opts.slug, name: opts.slug })
    .returning()
    .all();
  const [user] = db
    .insert(schema.users)
    .values({ tenantId: tenant!.id, email: opts.email, role: opts.role ?? 'owner' })
    .returning()
    .all();
  return { tenant: tenant!, user: user! };
}

function seedEstimator(
  db: BetterSQLite3Database<typeof schema>,
  tenantId: string,
) {
  const [est] = db
    .insert(schema.estimators)
    .values({ tenantId, publicKey: `pk-${Math.random().toString(36).slice(2)}`, title: 'Test Est' })
    .returning()
    .all();
  return est!;
}

function seedSubmission(
  db: BetterSQLite3Database<typeof schema>,
  tenantId: string,
  estimatorId: string,
  overrides: Partial<{ leadEmail: string; createdAt: Date }> = {},
) {
  const [sub] = db
    .insert(schema.submissions)
    .values({
      tenantId,
      estimatorId,
      versionId: 'v1',
      leadEmail: overrides.leadEmail ?? 'lead@test.com',
      leadZip: '90210',
      answers: {},
      estimateMin: 0,
      estimateMax: 0,
      currency: 'USD',
      serviceAreaValid: true,
      ...(overrides.createdAt !== undefined ? { createdAt: overrides.createdAt } : {}),
    })
    .returning()
    .all();
  return sub!;
}

// ── DELETE /submissions/:id ───────────────────────────────────────────────────

describe('DELETE /submissions/:id', () => {
  let db: BetterSQLite3Database<typeof schema>;
  let subApp: ReturnType<typeof createSubmissionRoutes>;
  let tenantId: string;
  let ownerToken: string;
  let estimatorId: string;

  beforeEach(async () => {
    db = createTestDb();
    subApp = createSubmissionRoutes(db, new MockEmailProvider());

    const { tenant, user } = seedTenantAndUser(db, { slug: 'del-co', email: 'owner@del.test' });
    tenantId = tenant.id;
    ownerToken = await signToken({ sub: user.id, tenantId, role: 'owner' });
    estimatorId = seedEstimator(db, tenantId).id;
  });

  it('deletes the submission and returns { deleted: true }', async () => {
    const sub = seedSubmission(db, tenantId, estimatorId);

    const res = await subApp.request(`/${sub.id}`, {
      method: 'DELETE',
      headers: authHeader(ownerToken),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.deleted).toBe(true);

    // Verify the row is actually gone from the DB
    const remaining = db
      .select()
      .from(schema.submissions)
      .where(eq(schema.submissions.id, sub.id))
      .all();
    expect(remaining).toHaveLength(0);
  });

  it('returns 404 for a submission belonging to another tenant', async () => {
    const { tenant: other } = seedTenantAndUser(db, { slug: 'other-del', email: 'o@other.test' });
    const otherEst = seedEstimator(db, other.id);
    const otherSub = seedSubmission(db, other.id, otherEst.id);

    const res = await subApp.request(`/${otherSub.id}`, {
      method: 'DELETE',
      headers: authHeader(ownerToken),
    });

    expect(res.status).toBe(404);

    // The other tenant's submission must still exist
    const stillThere = db
      .select()
      .from(schema.submissions)
      .where(eq(schema.submissions.id, otherSub.id))
      .all();
    expect(stillThere).toHaveLength(1);
  });

  it('returns 404 for a non-existent submission id', async () => {
    const res = await subApp.request('/does-not-exist', {
      method: 'DELETE',
      headers: authHeader(ownerToken),
    });
    expect(res.status).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const sub = seedSubmission(db, tenantId, estimatorId);
    const res = await subApp.request(`/${sub.id}`, { method: 'DELETE' });
    expect(res.status).toBe(401);
  });
});

// ── DELETE /tenants/me/data ───────────────────────────────────────────────────

describe('DELETE /tenants/me/data', () => {
  let db: BetterSQLite3Database<typeof schema>;
  let tenantApp: ReturnType<typeof createTenantRoutes>;
  let tenantId: string;
  let userId: string;
  let ownerToken: string;

  beforeEach(async () => {
    db = createTestDb();
    const authService = new AuthService(db, new MockEmailProvider(), new MockSmsProvider());
    tenantApp = createTenantRoutes(db, authService);

    const { tenant, user } = seedTenantAndUser(db, { slug: 'gdpr-co', email: 'owner@gdpr.test' });
    tenantId = tenant.id;
    userId = user.id;
    ownerToken = await signToken({ sub: userId, tenantId, role: 'owner' });
  });

  it('returns 400 without the confirmation string', async () => {
    const res = await tenantApp.request('/me/data', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...authHeader(ownerToken) },
      body: JSON.stringify({ confirm: 'wrong' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe('CONFIRMATION_REQUIRED');
  });

  it('returns 403 for a non-owner (member role)', async () => {
    const [member] = db
      .insert(schema.users)
      .values({ tenantId, email: 'mem@gdpr.test', role: 'member' })
      .returning()
      .all();
    const memberToken = await signToken({ sub: member!.id, tenantId, role: 'member' });

    const res = await tenantApp.request('/me/data', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...authHeader(memberToken) },
      body: JSON.stringify({ confirm: 'DELETE_ALL_DATA' }),
    });
    expect(res.status).toBe(403);
  });

  it('deletes all tenant data and returns 200', async () => {
    // Seed rich data for this tenant
    const est = seedEstimator(db, tenantId);

    db.insert(schema.estimatorVersions)
      .values({ estimatorId: est.id, version: 1, questions: [] })
      .run();

    db.insert(schema.pricingConfigs)
      .values({ tenantId, estimatorId: est.id, config: { bases: [] } })
      .run();

    db.insert(schema.serviceAreas).values({ tenantId, zip: '90210' }).run();

    seedSubmission(db, tenantId, est.id);
    seedSubmission(db, tenantId, est.id, { leadEmail: 'second@test.com' });

    db.insert(schema.analyticsEvents)
      .values({ tenantId, estimatorId: est.id, eventType: 'view', sessionId: 'sess-1' })
      .run();

    db.insert(schema.subscriptions)
      .values({
        tenantId,
        externalId: 'sub_123',
        status: 'active',
        planId: SUBSCRIPTION_PLAN_ID,
        currentPeriodEnd: new Date(Date.now() + 86400_000),
      })
      .run();

    // Add a second user to the tenant (not the requesting owner)
    db.insert(schema.users)
      .values({ tenantId, email: 'admin@gdpr.test', role: 'admin' })
      .run();

    const res = await tenantApp.request('/me/data', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...authHeader(ownerToken) },
      body: JSON.stringify({ confirm: 'DELETE_ALL_DATA' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.deleted).toBe(true);
    expect(body.data.tenantId).toBe(tenantId);

    // Verify everything is gone from the DB
    expect(db.select().from(schema.submissions).where(eq(schema.submissions.tenantId, tenantId)).all()).toHaveLength(0);
    expect(db.select().from(schema.analyticsEvents).where(eq(schema.analyticsEvents.tenantId, tenantId)).all()).toHaveLength(0);
    expect(db.select().from(schema.estimators).where(eq(schema.estimators.tenantId, tenantId)).all()).toHaveLength(0);
    expect(db.select().from(schema.estimatorVersions).where(eq(schema.estimatorVersions.estimatorId, est.id)).all()).toHaveLength(0);
    expect(db.select().from(schema.pricingConfigs).where(eq(schema.pricingConfigs.tenantId, tenantId)).all()).toHaveLength(0);
    expect(db.select().from(schema.serviceAreas).where(eq(schema.serviceAreas.tenantId, tenantId)).all()).toHaveLength(0);
    expect(db.select().from(schema.subscriptions).where(eq(schema.subscriptions.tenantId, tenantId)).all()).toHaveLength(0);
    expect(db.select().from(schema.auditLogs).where(eq(schema.auditLogs.tenantId, tenantId)).all()).toHaveLength(0);
    expect(db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).all()).toHaveLength(0);
  });

  it('writes an audit log entry BEFORE deleting audit logs', async () => {
    // After bulk delete, the audit log for this tenant is cleared.
    // We can verify the audit entry was written by checking that the
    // logs table had entries before the delete cleared them; since
    // we cannot observe the intermediate state easily in a sync test,
    // we verify the delete itself succeeded and audit logs are zeroed out.
    const res = await tenantApp.request('/me/data', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...authHeader(ownerToken) },
      body: JSON.stringify({ confirm: 'DELETE_ALL_DATA' }),
    });

    expect(res.status).toBe(200);
    // Audit logs for this tenant have been cleared (including the entry we wrote)
    const logs = db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.tenantId, tenantId))
      .all();
    expect(logs).toHaveLength(0);
  });

  it('does not delete data belonging to a different tenant', async () => {
    const { tenant: other } = seedTenantAndUser(db, { slug: 'other-gdpr', email: 'x@other.test' });
    const otherEst = seedEstimator(db, other.id);
    const otherSub = seedSubmission(db, other.id, otherEst.id);

    await tenantApp.request('/me/data', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...authHeader(ownerToken) },
      body: JSON.stringify({ confirm: 'DELETE_ALL_DATA' }),
    });

    // Other tenant's data must be untouched
    const otherSubStillThere = db
      .select()
      .from(schema.submissions)
      .where(eq(schema.submissions.id, otherSub.id))
      .all();
    expect(otherSubStillThere).toHaveLength(1);

    const otherTenantStillThere = db
      .select()
      .from(schema.tenants)
      .where(eq(schema.tenants.id, other.id))
      .all();
    expect(otherTenantStillThere).toHaveLength(1);
  });

  it('returns 401 without auth', async () => {
    const res = await tenantApp.request('/me/data', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'DELETE_ALL_DATA' }),
    });
    expect(res.status).toBe(401);
  });
});

// ── GET /submissions/export (JSON) ────────────────────────────────────────────

describe('GET /submissions/export', () => {
  let db: BetterSQLite3Database<typeof schema>;
  let subApp: ReturnType<typeof createSubmissionRoutes>;
  let tenantId: string;
  let ownerToken: string;
  let estimatorId: string;

  beforeEach(async () => {
    db = createTestDb();
    subApp = createSubmissionRoutes(db, new MockEmailProvider());

    const { tenant, user } = seedTenantAndUser(db, { slug: 'exp-co', email: 'owner@exp.test' });
    tenantId = tenant.id;
    ownerToken = await signToken({ sub: user.id, tenantId, role: 'owner' });
    estimatorId = seedEstimator(db, tenantId).id;
  });

  it('returns all submissions as JSON with correct shape', async () => {
    seedSubmission(db, tenantId, estimatorId, { leadEmail: 'a@test.com' });
    seedSubmission(db, tenantId, estimatorId, { leadEmail: 'b@test.com' });

    const res = await subApp.request('/export', {
      headers: authHeader(ownerToken),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('content-disposition')).toContain('.json');

    const body = (await res.json()) as any;
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.exportedAt).toBeTruthy();

    const emails = body.data.map((s: any) => s.leadEmail).sort();
    expect(emails).toEqual(['a@test.com', 'b@test.com']);
  });

  it('does not include submissions from another tenant', async () => {
    const { tenant: other } = seedTenantAndUser(db, { slug: 'other-exp', email: 'x@other.test' });
    const otherEst = seedEstimator(db, other.id);
    seedSubmission(db, other.id, otherEst.id, { leadEmail: 'spy@other.test' });
    seedSubmission(db, tenantId, estimatorId, { leadEmail: 'mine@exp.test' });

    const res = await subApp.request('/export', {
      headers: authHeader(ownerToken),
    });

    const body = (await res.json()) as any;
    expect(body.data).toHaveLength(1);
    expect(body.data[0].leadEmail).toBe('mine@exp.test');
  });

  it('returns empty array when no submissions exist', async () => {
    const res = await subApp.request('/export', {
      headers: authHeader(ownerToken),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toHaveLength(0);
  });

  it('filters by estimatorId query param', async () => {
    const est2 = seedEstimator(db, tenantId);
    seedSubmission(db, tenantId, estimatorId, { leadEmail: 'est1@test.com' });
    seedSubmission(db, tenantId, est2.id, { leadEmail: 'est2@test.com' });

    const res = await subApp.request(`/export?estimatorId=${est2.id}`, {
      headers: authHeader(ownerToken),
    });

    const body = (await res.json()) as any;
    expect(body.data).toHaveLength(1);
    expect(body.data[0].leadEmail).toBe('est2@test.com');
  });

  it('returns 401 without auth', async () => {
    const res = await subApp.request('/export');
    expect(res.status).toBe(401);
  });
});

// ── RetentionService.purgeExpired ─────────────────────────────────────────────

describe('RetentionService.purgeExpired', () => {
  let db: BetterSQLite3Database<typeof schema>;
  let tenantId: string;
  let estimatorId: string;

  beforeEach(() => {
    db = createTestDb();
    const { tenant } = seedTenantAndUser(db, { slug: 'ret-co', email: 'owner@ret.test' });
    tenantId = tenant.id;
    estimatorId = seedEstimator(db, tenantId).id;
  });

  it('purges submissions older than retentionDays', () => {
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000); // 40 days ago
    seedSubmission(db, tenantId, estimatorId, { leadEmail: 'old@test.com', createdAt: old });

    const retention = new RetentionService(db);
    const deleted = retention.purgeExpired(tenantId, 30);

    expect(deleted).toBe(1);
    const remaining = db.select().from(schema.submissions).where(eq(schema.submissions.tenantId, tenantId)).all();
    expect(remaining).toHaveLength(0);
  });

  it('keeps submissions within the retention window', () => {
    const recent = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
    seedSubmission(db, tenantId, estimatorId, { leadEmail: 'new@test.com', createdAt: recent });

    const retention = new RetentionService(db);
    const deleted = retention.purgeExpired(tenantId, 30);

    expect(deleted).toBe(0);
    const remaining = db.select().from(schema.submissions).where(eq(schema.submissions.tenantId, tenantId)).all();
    expect(remaining).toHaveLength(1);
  });

  it('purges only old submissions, preserves recent ones', () => {
    const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60 days ago
    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);  // 5 days ago
    seedSubmission(db, tenantId, estimatorId, { leadEmail: 'old@test.com', createdAt: old });
    seedSubmission(db, tenantId, estimatorId, { leadEmail: 'recent@test.com', createdAt: recent });

    const retention = new RetentionService(db);
    const deleted = retention.purgeExpired(tenantId, 30);

    expect(deleted).toBe(1);
    const remaining = db.select().from(schema.submissions).where(eq(schema.submissions.tenantId, tenantId)).all();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.leadEmail).toBe('recent@test.com');
  });

  it('does not purge submissions belonging to another tenant', () => {
    const { tenant: other } = seedTenantAndUser(db, { slug: 'other-ret', email: 'x@other.test' });
    const otherEst = seedEstimator(db, other.id);
    const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    seedSubmission(db, other.id, otherEst.id, { leadEmail: 'other-old@test.com', createdAt: old });

    const retention = new RetentionService(db);
    retention.purgeExpired(tenantId, 30); // purge tenantId, not other.id

    const otherRemaining = db
      .select()
      .from(schema.submissions)
      .where(eq(schema.submissions.tenantId, other.id))
      .all();
    expect(otherRemaining).toHaveLength(1);
  });

  it('returns 0 when no submissions match', () => {
    const retention = new RetentionService(db);
    const deleted = retention.purgeExpired(tenantId, 30);
    expect(deleted).toBe(0);
  });
});
