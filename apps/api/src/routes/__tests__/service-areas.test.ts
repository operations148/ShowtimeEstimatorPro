import { describe, it, expect, beforeEach } from 'vitest';
import { fileURLToPath } from 'url';
import path from 'path';
import * as fs from 'fs';
import { eq } from 'drizzle-orm';
import * as jose from 'jose';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { SESSION_COOKIE_NAME } from '@repo/shared';
import { createServiceAreaRoutes, parseCsvZips } from '../service-areas';
import { createSubmissionRoutes } from '../submissions';
import { MockEmailProvider } from '@repo/provider-adapters';
import * as schema from '../../models/schema';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_FOLDER = path.resolve(__dirname, '../../../drizzle');
const SAMPLE_CSV_PATH = path.resolve(__dirname, '../../../../../../attachments/service-area.sample.csv');

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

interface Fixtures {
  db: BetterSQLite3Database<typeof schema>;
  app: ReturnType<typeof createServiceAreaRoutes>;
  tenantId: string;
  token: string;
}

async function setup(serviceAreaBehavior: 'block' | 'warn' = 'block'): Promise<Fixtures> {
  const db = createTestDb();

  const [tenant] = db
    .insert(schema.tenants)
    .values({ slug: 'sa-test', name: 'SA Test Co', serviceAreaBehavior })
    .returning()
    .all();

  const [user] = db
    .insert(schema.users)
    .values({ tenantId: tenant!.id, email: 'owner@sa.test', role: 'owner' })
    .returning()
    .all();

  const token = await signToken({ sub: user!.id, tenantId: tenant!.id, role: 'owner' });
  const app = createServiceAreaRoutes(db);

  return { db, app, tenantId: tenant!.id, token };
}

// ── parseCsvZips unit tests ───────────────────────────────────────────────────

describe('parseCsvZips', () => {
  it('strips the "zip" header row', () => {
    expect(parseCsvZips('zip\n94103\n94107')).toEqual(['94103', '94107']);
  });

  it('handles CRLF line endings', () => {
    expect(parseCsvZips('zip\r\n94103\r\n94107\r\n')).toEqual(['94103', '94107']);
  });

  it('ignores blank lines', () => {
    expect(parseCsvZips('zip\n94103\n\n94107\n')).toEqual(['94103', '94107']);
  });

  it('trims whitespace from each zip', () => {
    expect(parseCsvZips('zip\n  94103  \n94107')).toEqual(['94103', '94107']);
  });

  it('parses sample CSV correctly', () => {
    const csv = fs.readFileSync(SAMPLE_CSV_PATH, 'utf-8');
    const zips = parseCsvZips(csv);
    expect(zips).toContain('94103');
    expect(zips).toContain('94107');
    expect(zips).toContain('94501');
    expect(zips).toContain('94502');
    expect(zips).not.toContain('zip');
    expect(zips.length).toBe(4);
  });
});

// ── Service area CRUD routes ──────────────────────────────────────────────────

describe('service area routes', () => {
  let f: Fixtures;
  beforeEach(async () => { f = await setup(); });

  describe('GET /', () => {
    it('returns empty list when no zips configured', async () => {
      const res = await f.app.request('/', { headers: authHeader(f.token) });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.data.zips).toEqual([]);
      expect(body.data.count).toBe(0);
    });

    it('returns configured zips', async () => {
      f.db.insert(schema.serviceAreas)
        .values([
          { tenantId: f.tenantId, zip: '94103' },
          { tenantId: f.tenantId, zip: '94107' },
        ])
        .run();

      const res = await f.app.request('/', { headers: authHeader(f.token) });
      const body = (await res.json()) as any;
      expect(body.data.count).toBe(2);
      expect(body.data.zips).toContain('94103');
      expect(body.data.zips).toContain('94107');
    });

    it('does not return another tenant\'s zips', async () => {
      const [other] = f.db.insert(schema.tenants)
        .values({ slug: 'other-sa', name: 'Other' })
        .returning().all();
      f.db.insert(schema.serviceAreas)
        .values({ tenantId: other!.id, zip: '10001' })
        .run();

      const res = await f.app.request('/', { headers: authHeader(f.token) });
      const body = (await res.json()) as any;
      expect(body.data.zips).not.toContain('10001');
    });

    it('unauthenticated → 401', async () => {
      const res = await f.app.request('/');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /import — raw CSV body', () => {
    it('imports zips from raw text/csv body', async () => {
      const res = await f.app.request('/import', {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv', ...authHeader(f.token) },
        body: 'zip\n94103\n94107\n94501',
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.data.imported).toBe(3);

      const zips = f.db.select().from(schema.serviceAreas)
        .where(eq(schema.serviceAreas.tenantId, f.tenantId))
        .all();
      expect(zips).toHaveLength(3);
    });

    it('replaces existing zips on re-import', async () => {
      // First import
      await f.app.request('/import', {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv', ...authHeader(f.token) },
        body: 'zip\n94103\n94107',
      });

      // Second import with different zips
      const res = await f.app.request('/import', {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv', ...authHeader(f.token) },
        body: 'zip\n10001',
      });
      expect(res.status).toBe(200);
      expect(((await res.json()) as any).data.imported).toBe(1);

      const zips = f.db.select({ zip: schema.serviceAreas.zip })
        .from(schema.serviceAreas)
        .all()
        .map((r) => r.zip);
      expect(zips).toEqual(['10001']);
    });

    it('empty CSV → 422', async () => {
      const res = await f.app.request('/import', {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv', ...authHeader(f.token) },
        body: 'zip\n',
      });
      expect(res.status).toBe(422);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('EMPTY_IMPORT');
    });

    it('imports the sample CSV file', async () => {
      const csv = fs.readFileSync(SAMPLE_CSV_PATH, 'utf-8');
      const res = await f.app.request('/import', {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv', ...authHeader(f.token) },
        body: csv,
      });
      expect(res.status).toBe(200);
      expect(((await res.json()) as any).data.imported).toBe(4);
    });

    it('wrong content-type → 400', async () => {
      const res = await f.app.request('/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(f.token) },
        body: JSON.stringify({ csv: 'zip\n94103' }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /', () => {
    it('clears all zips for the tenant', async () => {
      f.db.insert(schema.serviceAreas)
        .values([
          { tenantId: f.tenantId, zip: '94103' },
          { tenantId: f.tenantId, zip: '94107' },
        ])
        .run();

      const res = await f.app.request('/', {
        method: 'DELETE',
        headers: authHeader(f.token),
      });
      expect(res.status).toBe(200);
      expect(((await res.json()) as any).data.cleared).toBe(true);

      const list = await f.app.request('/', { headers: authHeader(f.token) });
      expect(((await list.json()) as any).data.count).toBe(0);
    });

    it('does not clear another tenant\'s zips', async () => {
      const [other] = f.db.insert(schema.tenants)
        .values({ slug: 'other-del', name: 'Other' })
        .returning().all();
      f.db.insert(schema.serviceAreas)
        .values({ tenantId: other!.id, zip: '10001' })
        .run();

      await f.app.request('/', { method: 'DELETE', headers: authHeader(f.token) });

      const remaining = f.db.select().from(schema.serviceAreas).all();
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.zip).toBe('10001');
    });
  });
});

// ── isZipServed semantics ─────────────────────────────────────────────────────

describe('ServiceAreaService.isZipServed', () => {
  it('returns true for any zip when service area is unconfigured (no rows)', async () => {
    const f = await setup();
    const { ServiceAreaService } = await import('../../services/service-area.service');
    const svc = new ServiceAreaService(f.db);
    expect(svc.isZipServed(f.tenantId, '99999')).toBe(true);
  });

  it('returns true for a zip that is in the configured list', async () => {
    const f = await setup();
    const { ServiceAreaService } = await import('../../services/service-area.service');
    f.db.insert(schema.serviceAreas).values({ tenantId: f.tenantId, zip: '94103' }).run();
    const svc = new ServiceAreaService(f.db);
    expect(svc.isZipServed(f.tenantId, '94103')).toBe(true);
  });

  it('returns false for a zip not in the configured list', async () => {
    const f = await setup();
    const { ServiceAreaService } = await import('../../services/service-area.service');
    f.db.insert(schema.serviceAreas).values({ tenantId: f.tenantId, zip: '94103' }).run();
    const svc = new ServiceAreaService(f.db);
    expect(svc.isZipServed(f.tenantId, '99999')).toBe(false);
  });
});

// ── Submission service-area integration ──────────────────────────────────────

describe('submission service-area behavior', () => {
  async function setupSubmission(behavior: 'block' | 'warn') {
    const db = createTestDb();

    const [tenant] = db
      .insert(schema.tenants)
      .values({ slug: `sub-${behavior}`, name: 'Sub Co', serviceAreaBehavior: behavior })
      .returning()
      .all();

    // Configure a single zip
    db.insert(schema.serviceAreas)
      .values({ tenantId: tenant!.id, zip: '94103' })
      .run();

    // Estimator
    const publicKey = 'a'.repeat(32);
    const [est] = db
      .insert(schema.estimators)
      .values({ tenantId: tenant!.id, publicKey, title: 'Test', branding: {} })
      .returning()
      .all();

    const mockEmail = new MockEmailProvider();
    const app = createSubmissionRoutes(db, mockEmail);

    return { db, app, tenant, est, publicKey };
  }

  const validBody = (publicKey: string, zip: string) => ({
    estimatorPublicKey: publicKey,
    lead: { email: 'user@test.com', zip, name: 'Test User', phone: '555-0100' },
    answers: { baseKey: 'pool_only', sizeKey: '15x30', addonKeys: [] },
  });

  describe('behavior = block', () => {
    it('served zip → 201', async () => {
      const { app, publicKey } = await setupSubmission('block');
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validBody(publicKey, '94103')),
      });
      expect(res.status).toBe(201);
    });

    it('unserved zip → 422 OUT_OF_AREA', async () => {
      const { app, publicKey } = await setupSubmission('block');
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validBody(publicKey, '99999')),
      });
      expect(res.status).toBe(422);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('OUT_OF_AREA');
    });

    it('no submission row created when blocked', async () => {
      const { app, db, publicKey } = await setupSubmission('block');
      await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validBody(publicKey, '99999')),
      });
      expect(db.select().from(schema.submissions).all()).toHaveLength(0);
    });
  });

  describe('behavior = warn', () => {
    it('served zip → 201 with serviceAreaValid=true', async () => {
      const { app, db, publicKey } = await setupSubmission('warn');
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validBody(publicKey, '94103')),
      });
      expect(res.status).toBe(201);
      const [sub] = db.select().from(schema.submissions).all();
      expect(sub!.serviceAreaValid).toBe(true);
    });

    it('unserved zip → 201 (not blocked) with serviceAreaValid=false', async () => {
      const { app, db, publicKey } = await setupSubmission('warn');
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validBody(publicKey, '99999')),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as any;
      expect(body.error).toBeNull();

      const [sub] = db.select().from(schema.submissions).all();
      expect(sub!.serviceAreaValid).toBe(false);
    });

    it('submission row is created even for unserved zip', async () => {
      const { app, db, publicKey } = await setupSubmission('warn');
      await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validBody(publicKey, '99999')),
      });
      expect(db.select().from(schema.submissions).all()).toHaveLength(1);
    });
  });

  describe('unconfigured service area', () => {
    it('any zip is accepted when no service area rows exist', async () => {
      const db = createTestDb();
      const [tenant] = db
        .insert(schema.tenants)
        .values({ slug: 'open', name: 'Open Co', serviceAreaBehavior: 'block' })
        .returning()
        .all();

      // No serviceArea rows for this tenant
      const publicKey = 'b'.repeat(32);
      db.insert(schema.estimators)
        .values({ tenantId: tenant!.id, publicKey, title: 'Open', branding: {} })
        .run();

      const app = createSubmissionRoutes(db, new MockEmailProvider());
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validBody(publicKey, '99999')),
      });
      // behavior=block but no service area configured → all zips served
      expect(res.status).toBe(201);
    });
  });
});
