import { describe, it, expect, beforeEach } from 'vitest';
import { fileURLToPath } from 'url';
import path from 'path';
import * as jose from 'jose';
import { eq } from 'drizzle-orm';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { MockEmailProvider, MockSmsProvider } from '@repo/provider-adapters';
import { SESSION_COOKIE_NAME } from '@repo/shared';
import { AuthService } from '../../services/auth.service';
import { createTenantRoutes } from '../tenants';
import { createUserRoutes } from '../users';
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

function authHeader(token: string): Record<string, string> {
  return { Cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

// ── Tenant routes ─────────────────────────────────────────────────────────────

describe('tenant routes', () => {
  let db: BetterSQLite3Database<typeof schema>;
  let tenantApp: ReturnType<typeof createTenantRoutes>;
  let mockEmail: MockEmailProvider;

  beforeEach(() => {
    db = createTestDb();
    mockEmail = new MockEmailProvider();
    const authService = new AuthService(db, mockEmail, new MockSmsProvider());
    tenantApp = createTenantRoutes(db, authService);
  });

  describe('POST /signup', () => {
    it('creates tenant + owner + sends OTP → 201', async () => {
      const res = await tenantApp.request('/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Acme Pools', slug: 'acme-pools', ownerEmail: 'owner@acme.test' }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as any;
      expect(body.data.tenant.slug).toBe('acme-pools');
      expect(body.data.owner.email).toBe('owner@acme.test');
      expect(body.data.owner.role).toBe('owner');
      expect(body.data.otp).not.toBeNull();
      expect(body.data.otp.expiresAt).toBeTruthy();
      // OTP email was sent
      expect(mockEmail.sentEmails).toHaveLength(1);
      expect(mockEmail.sentEmails[0]!.to).toBe('owner@acme.test');
    });

    it('duplicate slug → 409', async () => {
      const payload = { name: 'Acme', slug: 'acme', ownerEmail: 'a@test.com' };
      await tenantApp.request('/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const res = await tenantApp.request('/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('CONFLICT');
    });

    it('missing ownerEmail → 400', async () => {
      const res = await tenantApp.request('/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Acme', slug: 'acme' }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /me', () => {
    it('returns tenant details for authenticated user', async () => {
      // Create tenant + user
      const [tenant] = db
        .insert(schema.tenants)
        .values({ slug: 'myco', name: 'My Co' })
        .returning()
        .all();
      const [user] = db
        .insert(schema.users)
        .values({ tenantId: tenant!.id, email: 'me@myco.test', role: 'owner' })
        .returning()
        .all();

      const token = await signToken({ sub: user!.id, tenantId: tenant!.id, role: 'owner' });
      const res = await tenantApp.request('/me', {
        headers: { 'Content-Type': 'application/json', ...authHeader(token) },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.data.id).toBe(tenant!.id);
      expect(body.data.slug).toBe('myco');
    });

    it('no auth → 401', async () => {
      const res = await tenantApp.request('/me');
      expect(res.status).toBe(401);
    });
  });

  describe('PATCH /me', () => {
    it('owner can update tenant settings', async () => {
      const [tenant] = db
        .insert(schema.tenants)
        .values({ slug: 'co', name: 'Co' })
        .returning()
        .all();
      const [user] = db
        .insert(schema.users)
        .values({ tenantId: tenant!.id, email: 'owner@co.test', role: 'owner' })
        .returning()
        .all();

      const token = await signToken({ sub: user!.id, tenantId: tenant!.id, role: 'owner' });
      const res = await tenantApp.request('/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeader(token) },
        body: JSON.stringify({ name: 'Updated Co', serviceAreaBehavior: 'warn' }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.data.name).toBe('Updated Co');
      expect(body.data.serviceAreaBehavior).toBe('warn');
    });

    it('member → 403', async () => {
      const [tenant] = db
        .insert(schema.tenants)
        .values({ slug: 'co2', name: 'Co2' })
        .returning()
        .all();
      const [user] = db
        .insert(schema.users)
        .values({ tenantId: tenant!.id, email: 'member@co.test', role: 'member' })
        .returning()
        .all();

      const token = await signToken({ sub: user!.id, tenantId: tenant!.id, role: 'member' });
      const res = await tenantApp.request('/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeader(token) },
        body: JSON.stringify({ name: 'Hacked' }),
      });
      expect(res.status).toBe(403);
    });
  });
});

// ── User routes ───────────────────────────────────────────────────────────────

describe('user routes', () => {
  let db: BetterSQLite3Database<typeof schema>;
  let userApp: ReturnType<typeof createUserRoutes>;
  let tenantId: string;
  let ownerId: string;
  let ownerToken: string;

  beforeEach(async () => {
    db = createTestDb();
    userApp = createUserRoutes(db);

    const [tenant] = db
      .insert(schema.tenants)
      .values({ slug: 'testco', name: 'Test Co' })
      .returning()
      .all();
    tenantId = tenant!.id;

    const [owner] = db
      .insert(schema.users)
      .values({ tenantId, email: 'owner@testco.test', role: 'owner' })
      .returning()
      .all();
    ownerId = owner!.id;
    ownerToken = await signToken({ sub: ownerId, tenantId, role: 'owner' });
  });

  describe('GET /', () => {
    it('lists users scoped to the tenant', async () => {
      // Add a second tenant whose user must NOT appear
      const [other] = db
        .insert(schema.tenants)
        .values({ slug: 'other', name: 'Other' })
        .returning()
        .all();
      db.insert(schema.users)
        .values({ tenantId: other!.id, email: 'spy@other.test', role: 'member' })
        .run();

      const res = await userApp.request('/', {
        headers: authHeader(ownerToken),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.data).toHaveLength(1);
      expect(body.data[0].email).toBe('owner@testco.test');
    });

    it('unauthenticated → 401', async () => {
      const res = await userApp.request('/');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /', () => {
    it('owner can invite a new user → 201', async () => {
      const res = await userApp.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(ownerToken) },
        body: JSON.stringify({ email: 'newbie@testco.test', role: 'member' }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as any;
      expect(body.data.email).toBe('newbie@testco.test');
      expect(body.data.tenantId).toBe(tenantId);
    });

    it('member → 403', async () => {
      const [member] = db
        .insert(schema.users)
        .values({ tenantId, email: 'mem@testco.test', role: 'member' })
        .returning()
        .all();
      const memberToken = await signToken({ sub: member!.id, tenantId, role: 'member' });

      const res = await userApp.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(memberToken) },
        body: JSON.stringify({ email: 'x@testco.test', role: 'member' }),
      });
      expect(res.status).toBe(403);
    });
  });

  describe('PATCH /:id', () => {
    it('owner can change another user\'s role', async () => {
      const [target] = db
        .insert(schema.users)
        .values({ tenantId, email: 'target@testco.test', role: 'member' })
        .returning()
        .all();

      const res = await userApp.request(`/${target!.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeader(ownerToken) },
        body: JSON.stringify({ role: 'admin' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.data.role).toBe('admin');
    });

    it('cannot change own role → 403', async () => {
      const res = await userApp.request(`/${ownerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeader(ownerToken) },
        body: JSON.stringify({ role: 'member' }),
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it('user from another tenant → 404', async () => {
      const [other] = db
        .insert(schema.tenants)
        .values({ slug: 'other2', name: 'Other2' })
        .returning()
        .all();
      const [stranger] = db
        .insert(schema.users)
        .values({ tenantId: other!.id, email: 'stranger@other.test', role: 'member' })
        .returning()
        .all();

      const res = await userApp.request(`/${stranger!.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeader(ownerToken) },
        body: JSON.stringify({ role: 'admin' }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /:id', () => {
    it('owner can delete another user', async () => {
      const [target] = db
        .insert(schema.users)
        .values({ tenantId, email: 'del@testco.test', role: 'member' })
        .returning()
        .all();

      const res = await userApp.request(`/${target!.id}`, {
        method: 'DELETE',
        headers: authHeader(ownerToken),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.data.deleted).toBe(true);

      // Confirm actually removed
      const remaining = db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, target!.id))
        .all();
      expect(remaining).toHaveLength(0);
    });

    it('cannot delete yourself → 403', async () => {
      const res = await userApp.request(`/${ownerId}`, {
        method: 'DELETE',
        headers: authHeader(ownerToken),
      });
      expect(res.status).toBe(403);
    });

    it('user from another tenant → 404', async () => {
      const [other] = db
        .insert(schema.tenants)
        .values({ slug: 'other3', name: 'Other3' })
        .returning()
        .all();
      const [stranger] = db
        .insert(schema.users)
        .values({ tenantId: other!.id, email: 's2@other.test', role: 'member' })
        .returning()
        .all();

      const res = await userApp.request(`/${stranger!.id}`, {
        method: 'DELETE',
        headers: authHeader(ownerToken),
      });
      expect(res.status).toBe(404);
    });
  });
});
