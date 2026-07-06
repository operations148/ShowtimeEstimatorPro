import { describe, it, expect, beforeEach } from 'vitest';
import { fileURLToPath } from 'url';
import path from 'path';
import * as jose from 'jose';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { SESSION_COOKIE_NAME } from '@repo/shared';
import { AuditService } from '../../services/audit.service';
import { createAuditLogRoutes } from '../audit-logs';
import { createUserRoutes } from '../users';
import { createEstimatorRoutes } from '../estimators';
import { createServiceAreaRoutes } from '../service-areas';
import { createExportRoutes } from '../exports';
import { createSubmissionRoutes } from '../submissions';
import { MockEmailProvider } from '@repo/provider-adapters';
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

function authHeader(token: string, extra: Record<string, string> = {}) {
  return { Cookie: `${SESSION_COOKIE_NAME}=${token}`, ...extra };
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
  const pk = Math.random().toString(36).slice(2).padEnd(32, 'x');
  const [e] = db
    .insert(schema.estimators)
    .values({ tenantId, publicKey: pk, title: 'Test', branding: {} })
    .returning()
    .all();
  return e!;
}

function seedSubmission(
  db: BetterSQLite3Database<typeof schema>,
  tenantId: string,
  estimatorId: string,
) {
  const [s] = db
    .insert(schema.submissions)
    .values({
      tenantId,
      estimatorId,
      versionId: 'v1',
      leadEmail: `lead-${Math.random()}@test.com`,
      leadZip: '94103',
      answers: {},
      estimateMin: 1000,
      estimateMax: 2000,
    })
    .returning()
    .all();
  return s!;
}

// ── AuditService unit tests ───────────────────────────────────────────────────

describe('AuditService', () => {
  let db: BetterSQLite3Database<typeof schema>;
  let svc: AuditService;
  let tenantId: string;

  beforeEach(() => {
    db = createTestDb();
    svc = new AuditService(db);
    tenantId = seedTenant(db, 'audit-unit-' + Date.now()).id;
  });

  it('logAction inserts a row into audit_logs', () => {
    svc.logAction({
      tenantId,
      actorId: 'user-1',
      action: 'user.create',
      resourceType: 'user',
      resourceId: 'user-2',
    });

    const rows = db.select().from(schema.auditLogs).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe('user.create');
    expect(rows[0]!.resourceType).toBe('user');
    expect(rows[0]!.tenantId).toBe(tenantId);
  });

  it('logAction stores ip and user-agent when provided', () => {
    svc.logAction({
      tenantId,
      actorId: 'u1',
      action: 'estimator.create',
      resourceType: 'estimator',
      resourceId: 'est-1',
      ipAddress: '1.2.3.4',
      userAgent: 'Mozilla/5.0',
    });

    const [row] = db.select().from(schema.auditLogs).all();
    expect(row!.ipAddress).toBe('1.2.3.4');
    expect(row!.userAgent).toBe('Mozilla/5.0');
  });

  it('queryLogs returns all logs for the tenant', () => {
    svc.logAction({ tenantId, actorId: 'u1', action: 'a', resourceType: 'x', resourceId: '1' });
    svc.logAction({ tenantId, actorId: 'u1', action: 'b', resourceType: 'x', resourceId: '2' });

    const result = svc.queryLogs(tenantId);
    expect(result.logs).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it('queryLogs is tenant-scoped', () => {
    const other = seedTenant(db, 'other-audit-' + Date.now());
    svc.logAction({ tenantId: other.id, actorId: 'u2', action: 'a', resourceType: 'x', resourceId: '1' });
    svc.logAction({ tenantId, actorId: 'u1', action: 'b', resourceType: 'x', resourceId: '2' });

    const result = svc.queryLogs(tenantId);
    expect(result.logs).toHaveLength(1);
    expect(result.logs[0]!.action).toBe('b');
  });

  it('queryLogs filters by actorId', () => {
    svc.logAction({ tenantId, actorId: 'u1', action: 'a', resourceType: 'x', resourceId: '1' });
    svc.logAction({ tenantId, actorId: 'u2', action: 'b', resourceType: 'x', resourceId: '2' });

    const result = svc.queryLogs(tenantId, { actorId: 'u1' });
    expect(result.logs).toHaveLength(1);
    expect(result.logs[0]!.actorId).toBe('u1');
  });

  it('queryLogs filters by action', () => {
    svc.logAction({ tenantId, actorId: 'u1', action: 'user.create', resourceType: 'user', resourceId: '1' });
    svc.logAction({ tenantId, actorId: 'u1', action: 'user.delete', resourceType: 'user', resourceId: '2' });

    const result = svc.queryLogs(tenantId, { action: 'user.create' });
    expect(result.logs).toHaveLength(1);
    expect(result.logs[0]!.action).toBe('user.create');
  });

  it('queryLogs filters by resourceType', () => {
    svc.logAction({ tenantId, actorId: 'u1', action: 'x', resourceType: 'user', resourceId: '1' });
    svc.logAction({ tenantId, actorId: 'u1', action: 'y', resourceType: 'estimator', resourceId: '2' });

    const result = svc.queryLogs(tenantId, { resourceType: 'estimator' });
    expect(result.logs).toHaveLength(1);
    expect(result.logs[0]!.resourceType).toBe('estimator');
  });

  it('queryLogs filters by from date', () => {
    const early = new Date('2025-01-01T00:00:00Z');
    const late = new Date('2025-12-01T00:00:00Z');

    // Manually insert with specific timestamps
    db.insert(schema.auditLogs).values({
      tenantId, actorId: 'u1', action: 'old', resourceType: 'x', resourceId: '1', timestamp: early,
    }).run();
    db.insert(schema.auditLogs).values({
      tenantId, actorId: 'u1', action: 'new', resourceType: 'x', resourceId: '2', timestamp: late,
    }).run();

    const result = svc.queryLogs(tenantId, { from: new Date('2025-06-01T00:00:00Z') });
    expect(result.logs).toHaveLength(1);
    expect(result.logs[0]!.action).toBe('new');
  });

  it('queryLogs filters by to date', () => {
    const early = new Date('2025-01-01T00:00:00Z');
    const late = new Date('2025-12-01T00:00:00Z');

    db.insert(schema.auditLogs).values({
      tenantId, actorId: 'u1', action: 'old', resourceType: 'x', resourceId: '1', timestamp: early,
    }).run();
    db.insert(schema.auditLogs).values({
      tenantId, actorId: 'u1', action: 'new', resourceType: 'x', resourceId: '2', timestamp: late,
    }).run();

    const result = svc.queryLogs(tenantId, { to: new Date('2025-06-01T00:00:00Z') });
    expect(result.logs).toHaveLength(1);
    expect(result.logs[0]!.action).toBe('old');
  });

  it('queryLogs paginates correctly', () => {
    for (let i = 0; i < 5; i++) {
      svc.logAction({ tenantId, actorId: 'u1', action: `action-${i}`, resourceType: 'x', resourceId: `${i}` });
    }

    const page1 = svc.queryLogs(tenantId, { limit: 2, offset: 0 });
    const page2 = svc.queryLogs(tenantId, { limit: 2, offset: 2 });
    const page3 = svc.queryLogs(tenantId, { limit: 2, offset: 4 });

    expect(page1.logs).toHaveLength(2);
    expect(page2.logs).toHaveLength(2);
    expect(page3.logs).toHaveLength(1);
    expect(page1.total).toBe(5); // total always reflects unfiltered count
  });

  it('queryLogs returns results ordered newest-first', () => {
    const t1 = new Date('2025-01-01T00:00:00Z');
    const t2 = new Date('2025-06-01T00:00:00Z');
    const t3 = new Date('2025-12-01T00:00:00Z');

    db.insert(schema.auditLogs).values({ tenantId, actorId: 'u1', action: 'a', resourceType: 'x', resourceId: '1', timestamp: t1 }).run();
    db.insert(schema.auditLogs).values({ tenantId, actorId: 'u1', action: 'b', resourceType: 'x', resourceId: '2', timestamp: t3 }).run();
    db.insert(schema.auditLogs).values({ tenantId, actorId: 'u1', action: 'c', resourceType: 'x', resourceId: '3', timestamp: t2 }).run();

    const result = svc.queryLogs(tenantId);
    expect(result.logs[0]!.action).toBe('b'); // newest first
    expect(result.logs[1]!.action).toBe('c');
    expect(result.logs[2]!.action).toBe('a');
  });
});

// ── Audit middleware integration: CRUD actions create log entries ─────────────

describe('audit middleware — CRUD actions create log entries', () => {
  let db: BetterSQLite3Database<typeof schema>;
  let auditSvc: AuditService;
  let tenantId: string;
  let userId: string;
  let ownerToken: string;

  beforeEach(async () => {
    db = createTestDb();
    auditSvc = new AuditService(db);
    const tenant = seedTenant(db, 'audit-mw-' + Date.now());
    tenantId = tenant.id;
    const user = seedUser(db, tenantId, 'owner');
    userId = user.id;
    ownerToken = await signToken({ sub: userId, tenantId, role: 'owner' });
  });

  it('POST /users creates a user.create audit log entry', async () => {
    const app = createUserRoutes(db, auditSvc);

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(ownerToken) },
      body: JSON.stringify({ email: 'new@test.com', role: 'member' }),
    });
    expect(res.status).toBe(201);

    const logs = db.select().from(schema.auditLogs).all();
    expect(logs).toHaveLength(1);
    expect(logs[0]!.action).toBe('user.create');
    expect(logs[0]!.resourceType).toBe('user');
    expect(logs[0]!.actorId).toBe(userId);
    expect(logs[0]!.tenantId).toBe(tenantId);
    // resourceId should be the new user's id (extracted from response body)
    expect(logs[0]!.resourceId).toBeTruthy();
    expect(logs[0]!.resourceId).not.toBe('unknown');
  });

  it('PATCH /users/:id creates a user.update audit log entry', async () => {
    const target = seedUser(db, tenantId, 'member');
    const app = createUserRoutes(db, auditSvc);

    const res = await app.request(`/${target.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader(ownerToken) },
      body: JSON.stringify({ role: 'admin' }),
    });
    expect(res.status).toBe(200);

    const logs = db.select().from(schema.auditLogs).all();
    expect(logs).toHaveLength(1);
    expect(logs[0]!.action).toBe('user.update');
    expect(logs[0]!.resourceId).toBe(target.id);
  });

  it('DELETE /users/:id creates a user.delete audit log entry', async () => {
    const target = seedUser(db, tenantId, 'member');
    const app = createUserRoutes(db, auditSvc);

    const res = await app.request(`/${target.id}`, {
      method: 'DELETE',
      headers: authHeader(ownerToken),
    });
    expect(res.status).toBe(200);

    const logs = db.select().from(schema.auditLogs).all();
    expect(logs).toHaveLength(1);
    expect(logs[0]!.action).toBe('user.delete');
    expect(logs[0]!.resourceId).toBe(target.id);
  });

  it('POST /estimators creates an estimator.create audit log entry', async () => {
    const app = createEstimatorRoutes(db, undefined, auditSvc);

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(ownerToken) },
      body: JSON.stringify({ title: 'My Estimator', branding: {} }),
    });
    expect(res.status).toBe(201);

    const logs = db.select().from(schema.auditLogs).all();
    expect(logs).toHaveLength(1);
    expect(logs[0]!.action).toBe('estimator.create');
    expect(logs[0]!.resourceId).toBeTruthy();
    expect(logs[0]!.resourceId).not.toBe('unknown');
  });

  it('POST /estimators/:id/publish creates an estimator.publish audit log entry', async () => {
    const est = seedEstimator(db, tenantId);
    const app = createEstimatorRoutes(db, undefined, auditSvc);

    const res = await app.request(`/${est.id}/publish`, {
      method: 'POST',
      headers: authHeader(ownerToken),
    });
    expect(res.status).toBe(200);

    const logs = db.select().from(schema.auditLogs).all();
    expect(logs).toHaveLength(1);
    expect(logs[0]!.action).toBe('estimator.publish');
    expect(logs[0]!.resourceId).toBe(est.id);
  });

  it('POST /estimators/:id/unpublish creates an estimator.unpublish audit log entry', async () => {
    const est = seedEstimator(db, tenantId);
    const app = createEstimatorRoutes(db, undefined, auditSvc);

    const res = await app.request(`/${est.id}/unpublish`, {
      method: 'POST',
      headers: authHeader(ownerToken),
    });
    expect(res.status).toBe(200);

    const logs = db.select().from(schema.auditLogs).all();
    expect(logs).toHaveLength(1);
    expect(logs[0]!.action).toBe('estimator.unpublish');
    expect(logs[0]!.resourceId).toBe(est.id);
  });

  it('DELETE /estimators/:id creates an estimator.delete audit log entry', async () => {
    const est = seedEstimator(db, tenantId);
    const app = createEstimatorRoutes(db, undefined, auditSvc);

    const res = await app.request(`/${est.id}`, {
      method: 'DELETE',
      headers: authHeader(ownerToken),
    });
    expect(res.status).toBe(200);

    const logs = db.select().from(schema.auditLogs).all();
    expect(logs).toHaveLength(1);
    expect(logs[0]!.action).toBe('estimator.delete');
    expect(logs[0]!.resourceId).toBe(est.id);
  });

  it('POST /service-areas/import creates a service_area.import audit log entry', async () => {
    const app = createServiceAreaRoutes(db, auditSvc);

    const res = await app.request('/import', {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv', ...authHeader(ownerToken) },
      body: 'zip\n94103\n94107',
    });
    expect(res.status).toBe(200);

    const logs = db.select().from(schema.auditLogs).all();
    expect(logs).toHaveLength(1);
    expect(logs[0]!.action).toBe('service_area.import');
    expect(logs[0]!.resourceType).toBe('service_area');
  });

  it('DELETE /service-areas creates a service_area.clear audit log entry', async () => {
    const app = createServiceAreaRoutes(db, auditSvc);

    const res = await app.request('/', {
      method: 'DELETE',
      headers: authHeader(ownerToken),
    });
    expect(res.status).toBe(200);

    const logs = db.select().from(schema.auditLogs).all();
    expect(logs).toHaveLength(1);
    expect(logs[0]!.action).toBe('service_area.clear');
  });

  it('DELETE /submissions/:id creates a submission.delete audit log entry', async () => {
    const est = seedEstimator(db, tenantId);
    const sub = seedSubmission(db, tenantId, est.id);
    const app = createSubmissionRoutes(db, new MockEmailProvider(), auditSvc);

    const res = await app.request(`/${sub.id}`, {
      method: 'DELETE',
      headers: authHeader(ownerToken),
    });
    expect(res.status).toBe(200);

    const logs = db.select().from(schema.auditLogs).all();
    expect(logs).toHaveLength(1);
    expect(logs[0]!.action).toBe('submission.delete');
    expect(logs[0]!.resourceId).toBe(sub.id);
  });

  it('GET /exports/submissions creates an export.download audit log entry', async () => {
    const app = createExportRoutes(db, auditSvc);

    const res = await app.request('/submissions', { headers: authHeader(ownerToken) });
    expect(res.status).toBe(200);

    const logs = db.select().from(schema.auditLogs).all();
    expect(logs).toHaveLength(1);
    expect(logs[0]!.action).toBe('export.download');
    expect(logs[0]!.resourceType).toBe('export');
  });

  it('failed actions (4xx) do NOT create audit log entries', async () => {
    const app = createUserRoutes(db, auditSvc);

    // POST with invalid body → 400
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(ownerToken) },
      body: JSON.stringify({ email: 'not-an-email', role: 'invalid-role' }),
    });
    expect(res.status).toBe(400);

    const logs = db.select().from(schema.auditLogs).all();
    expect(logs).toHaveLength(0);
  });

  it('captures x-forwarded-for IP in the audit log', async () => {
    const app = createUserRoutes(db, auditSvc);
    const target = seedUser(db, tenantId, 'member');

    await app.request(`/${target.id}`, {
      method: 'DELETE',
      headers: {
        ...authHeader(ownerToken),
        'x-forwarded-for': '203.0.113.45, 10.0.0.1',
      },
    });

    const [log] = db.select().from(schema.auditLogs).all();
    expect(log!.ipAddress).toBe('203.0.113.45'); // first value only
  });

  it('captures user-agent in the audit log', async () => {
    const app = createUserRoutes(db, auditSvc);
    const target = seedUser(db, tenantId, 'member');

    await app.request(`/${target.id}`, {
      method: 'DELETE',
      headers: {
        ...authHeader(ownerToken),
        'user-agent': 'TestBrowser/1.0',
      },
    });

    const [log] = db.select().from(schema.auditLogs).all();
    expect(log!.userAgent).toBe('TestBrowser/1.0');
  });
});

// ── GET /audit-logs route ─────────────────────────────────────────────────────

describe('GET /audit-logs', () => {
  let db: BetterSQLite3Database<typeof schema>;
  let auditSvc: AuditService;
  let auditApp: ReturnType<typeof createAuditLogRoutes>;
  let tenantId: string;
  let ownerToken: string;

  beforeEach(async () => {
    db = createTestDb();
    auditSvc = new AuditService(db);
    auditApp = createAuditLogRoutes(db);

    const tenant = seedTenant(db, 'route-audit-' + Date.now());
    tenantId = tenant.id;
    const owner = seedUser(db, tenantId, 'owner');
    ownerToken = await signToken({ sub: owner.id, tenantId, role: 'owner' });
  });

  it('returns 200 with empty list when no logs exist', async () => {
    const res = await auditApp.request('/', { headers: authHeader(ownerToken) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toEqual([]);
    expect(body.meta.total).toBe(0);
  });

  it('returns logs for the authenticated tenant', async () => {
    auditSvc.logAction({ tenantId, actorId: 'u1', action: 'user.create', resourceType: 'user', resourceId: 'r1' });
    auditSvc.logAction({ tenantId, actorId: 'u1', action: 'user.delete', resourceType: 'user', resourceId: 'r2' });

    const res = await auditApp.request('/', { headers: authHeader(ownerToken) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toHaveLength(2);
    expect(body.meta.total).toBe(2);
  });

  it('unauthenticated → 401', async () => {
    const res = await auditApp.request('/');
    expect(res.status).toBe(401);
  });

  it('member role → 403', async () => {
    const member = seedUser(db, tenantId, 'member');
    const memberToken = await signToken({ sub: member.id, tenantId, role: 'member' });

    const res = await auditApp.request('/', { headers: authHeader(memberToken) });
    expect(res.status).toBe(403);
  });

  it('admin role → 200', async () => {
    const admin = seedUser(db, tenantId, 'admin');
    const adminToken = await signToken({ sub: admin.id, tenantId, role: 'admin' });

    const res = await auditApp.request('/', { headers: authHeader(adminToken) });
    expect(res.status).toBe(200);
  });

  it('filters by action query param', async () => {
    auditSvc.logAction({ tenantId, actorId: 'u1', action: 'user.create', resourceType: 'user', resourceId: '1' });
    auditSvc.logAction({ tenantId, actorId: 'u1', action: 'user.delete', resourceType: 'user', resourceId: '2' });

    const res = await auditApp.request('/?action=user.create', { headers: authHeader(ownerToken) });
    const body = (await res.json()) as any;
    expect(body.data).toHaveLength(1);
    expect(body.data[0].action).toBe('user.create');
  });

  it('filters by resourceType query param', async () => {
    auditSvc.logAction({ tenantId, actorId: 'u1', action: 'x', resourceType: 'user', resourceId: '1' });
    auditSvc.logAction({ tenantId, actorId: 'u1', action: 'y', resourceType: 'estimator', resourceId: '2' });

    const res = await auditApp.request('/?resourceType=estimator', { headers: authHeader(ownerToken) });
    const body = (await res.json()) as any;
    expect(body.data).toHaveLength(1);
    expect(body.data[0].resourceType).toBe('estimator');
  });

  it('paginates with limit and offset', async () => {
    for (let i = 0; i < 5; i++) {
      auditSvc.logAction({ tenantId, actorId: 'u1', action: `a${i}`, resourceType: 'x', resourceId: `${i}` });
    }

    const res = await auditApp.request('/?limit=2&offset=2', { headers: authHeader(ownerToken) });
    const body = (await res.json()) as any;
    expect(body.data).toHaveLength(2);
    expect(body.meta.total).toBe(5);
    expect(body.meta.limit).toBe(2);
    expect(body.meta.offset).toBe(2);
  });

  it('invalid from date → 400', async () => {
    const res = await auditApp.request('/?from=bad', { headers: authHeader(ownerToken) });
    expect(res.status).toBe(400);
  });

  it('invalid to date → 400', async () => {
    const res = await auditApp.request('/?to=bad', { headers: authHeader(ownerToken) });
    expect(res.status).toBe(400);
  });

  it('cross-tenant isolation — owner sees only own tenant logs', async () => {
    const other = seedTenant(db, 'other-audit-route-' + Date.now());
    auditSvc.logAction({ tenantId: other.id, actorId: 'u2', action: 'spy', resourceType: 'x', resourceId: '1' });
    auditSvc.logAction({ tenantId, actorId: 'u1', action: 'own', resourceType: 'x', resourceId: '2' });

    const res = await auditApp.request('/', { headers: authHeader(ownerToken) });
    const body = (await res.json()) as any;
    expect(body.data).toHaveLength(1);
    expect(body.data[0].action).toBe('own');
  });

  it('no write endpoints exist (POST → 404)', async () => {
    const res = await auditApp.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(ownerToken) },
      body: JSON.stringify({ action: 'fake' }),
    });
    // Hono returns 404 for unregistered routes
    expect(res.status).toBe(404);
  });

  it('no write endpoints exist (DELETE → 404)', async () => {
    const res = await auditApp.request('/some-id', {
      method: 'DELETE',
      headers: authHeader(ownerToken),
    });
    expect(res.status).toBe(404);
  });
});
