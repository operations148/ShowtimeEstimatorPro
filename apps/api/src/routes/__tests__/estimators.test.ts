import { describe, it, expect, beforeEach } from 'vitest';
import { fileURLToPath } from 'url';
import path from 'path';
import * as jose from 'jose';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { SESSION_COOKIE_NAME } from '@repo/shared';
import { createEstimatorRoutes } from '../estimators';
import * as schema from '../../models/schema';
import { eq } from 'drizzle-orm';

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

const SAMPLE_QUESTIONS = [
  {
    id: 'q1',
    stepId: 'q1',
    type: 'single' as const,
    label: 'Pool type',
    options: ['In-ground', 'Above-ground'],
    required: true,
    order: 0,
  },
];

// ── Fixtures ──────────────────────────────────────────────────────────────────

interface Fixtures {
  db: BetterSQLite3Database<typeof schema>;
  app: ReturnType<typeof createEstimatorRoutes>;
  tenantId: string;
  userId: string;
  token: string;
}

async function setup(): Promise<Fixtures> {
  const db = createTestDb();
  const app = createEstimatorRoutes(db);

  const [tenant] = db
    .insert(schema.tenants)
    .values({ slug: 'est-test', name: 'Est Test Co' })
    .returning()
    .all();

  const [user] = db
    .insert(schema.users)
    .values({ tenantId: tenant!.id, email: 'owner@est.test', role: 'owner' })
    .returning()
    .all();

  const token = await signToken({ sub: user!.id, tenantId: tenant!.id, role: 'owner' });

  return { db, app, tenantId: tenant!.id, userId: user!.id, token };
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

describe('estimator CRUD', () => {
  let f: Fixtures;
  beforeEach(async () => { f = await setup(); });

  it('POST / → 201 creates estimator + draft version with questions: []', async () => {
    const res = await f.app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(f.token) },
      body: JSON.stringify({ title: 'Pool Estimator' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.data.title).toBe('Pool Estimator');
    expect(body.data.status).toBe('draft');
    expect(body.data.publicKey).toHaveLength(32); // 16 bytes hex
    expect(body.data.questions).toEqual([]);
    expect(body.data.currentVersionId).toBeTruthy();
  });

  it('GET / → lists only this tenant\'s estimators', async () => {
    // Create estimator for this tenant
    await f.app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(f.token) },
      body: JSON.stringify({ title: 'Mine' }),
    });

    // Create another tenant + estimator — must NOT appear
    const [other] = f.db
      .insert(schema.tenants)
      .values({ slug: 'other-t', name: 'Other' })
      .returning()
      .all();
    f.db.insert(schema.estimators)
      .values({ tenantId: other!.id, publicKey: 'x'.repeat(32), title: 'Theirs', branding: {} })
      .run();

    const res = await f.app.request('/', { headers: authHeader(f.token) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toHaveLength(1);
    expect(body.data[0].title).toBe('Mine');
  });

  it('GET /:id → includes questions from current version', async () => {
    const createRes = await f.app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(f.token) },
      body: JSON.stringify({ title: 'With Questions' }),
    });
    const { data: est } = (await createRes.json()) as any;

    // Put questions on the version
    await f.app.request(`/${est.id}/questions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeader(f.token) },
      body: JSON.stringify({ questions: SAMPLE_QUESTIONS }),
    });

    const res = await f.app.request(`/${est.id}`, { headers: authHeader(f.token) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.questions).toHaveLength(1);
    expect(body.data.questions[0].id).toBe('q1');
  });

  it('GET /:id → 404 for estimator belonging to another tenant', async () => {
    const [other] = f.db
      .insert(schema.tenants)
      .values({ slug: 'other-get', name: 'Other' })
      .returning()
      .all();
    const [foreignEst] = f.db
      .insert(schema.estimators)
      .values({ tenantId: other!.id, publicKey: 'y'.repeat(32), title: 'Foreign', branding: {} })
      .returning()
      .all();

    const res = await f.app.request(`/${foreignEst!.id}`, { headers: authHeader(f.token) });
    expect(res.status).toBe(404);
  });

  it('PATCH /:id → updates title and branding', async () => {
    const createRes = await f.app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(f.token) },
      body: JSON.stringify({ title: 'Original' }),
    });
    const { data: est } = (await createRes.json()) as any;

    const res = await f.app.request(`/${est.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeader(f.token) },
      body: JSON.stringify({ title: 'Updated', branding: { primaryColor: '#ff0000' } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.title).toBe('Updated');
    expect(body.data.branding.primaryColor).toBe('#ff0000');
  });

  it('DELETE /:id → removes estimator, 404 on second delete', async () => {
    const createRes = await f.app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(f.token) },
      body: JSON.stringify({ title: 'ToDelete' }),
    });
    const { data: est } = (await createRes.json()) as any;

    const del = await f.app.request(`/${est.id}`, {
      method: 'DELETE',
      headers: authHeader(f.token),
    });
    expect(del.status).toBe(200);
    expect(((await del.json()) as any).data.deleted).toBe(true);

    const del2 = await f.app.request(`/${est.id}`, {
      method: 'DELETE',
      headers: authHeader(f.token),
    });
    expect(del2.status).toBe(404);
  });
});

// ── Questions ─────────────────────────────────────────────────────────────────

describe('questions', () => {
  let f: Fixtures;
  beforeEach(async () => { f = await setup(); });

  it('PUT /:id/questions → updates questions on draft version', async () => {
    const createRes = await f.app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(f.token) },
      body: JSON.stringify({ title: 'Q test' }),
    });
    const { data: est } = (await createRes.json()) as any;

    const res = await f.app.request(`/${est.id}/questions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeader(f.token) },
      body: JSON.stringify({ questions: SAMPLE_QUESTIONS }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.questions).toHaveLength(1);
    expect(body.data.questions[0].label).toBe('Pool type');
  });

  it('PUT /:id/questions on published → auto-forks new draft version', async () => {
    const createRes = await f.app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(f.token) },
      body: JSON.stringify({ title: 'Versioned' }),
    });
    const { data: est } = (await createRes.json()) as any;
    const originalVersionId = est.currentVersionId;

    // Publish
    await f.app.request(`/${est.id}/publish`, {
      method: 'POST',
      headers: authHeader(f.token),
    });

    // Edit questions on published estimator
    const res = await f.app.request(`/${est.id}/questions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeader(f.token) },
      body: JSON.stringify({ questions: SAMPLE_QUESTIONS }),
    });
    expect(res.status).toBe(200);

    // Estimator should now be draft with a new currentVersionId
    const getRes = await f.app.request(`/${est.id}`, { headers: authHeader(f.token) });
    const updated = ((await getRes.json()) as any).data;
    expect(updated.status).toBe('draft');
    expect(updated.currentVersionId).not.toBe(originalVersionId);
    expect(updated.questions).toHaveLength(1);

    // Two versions should exist
    const versRes = await f.app.request(`/${est.id}/versions`, { headers: authHeader(f.token) });
    const versions = ((await versRes.json()) as any).data;
    expect(versions).toHaveLength(2);
  });

  it('PUT /:id/questions → 400 on invalid question shape', async () => {
    const createRes = await f.app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(f.token) },
      body: JSON.stringify({ title: 'Invalid Q' }),
    });
    const { data: est } = (await createRes.json()) as any;

    const res = await f.app.request(`/${est.id}/questions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeader(f.token) },
      body: JSON.stringify({ questions: [{ id: 'q1' }] }), // missing required fields
    });
    expect(res.status).toBe(400);
  });
});

// ── Publish / unpublish lifecycle ─────────────────────────────────────────────

describe('publish lifecycle', () => {
  let f: Fixtures;
  beforeEach(async () => { f = await setup(); });

  async function createEst(title: string) {
    const res = await f.app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(f.token) },
      body: JSON.stringify({ title }),
    });
    return ((await res.json()) as any).data;
  }

  it('POST /:id/publish → status becomes published', async () => {
    const est = await createEst('Publish me');
    const res = await f.app.request(`/${est.id}/publish`, {
      method: 'POST',
      headers: authHeader(f.token),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data.status).toBe('published');
  });

  it('POST /:id/unpublish → status becomes draft', async () => {
    const est = await createEst('Unpublish me');
    await f.app.request(`/${est.id}/publish`, { method: 'POST', headers: authHeader(f.token) });

    const res = await f.app.request(`/${est.id}/unpublish`, {
      method: 'POST',
      headers: authHeader(f.token),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data.status).toBe('draft');
  });

  it('publish → 404 for unknown estimator', async () => {
    const res = await f.app.request('/nonexistent-id/publish', {
      method: 'POST',
      headers: authHeader(f.token),
    });
    expect(res.status).toBe(404);
  });
});

// ── Versioning ────────────────────────────────────────────────────────────────

describe('versioning', () => {
  let f: Fixtures;
  beforeEach(async () => { f = await setup(); });

  async function createEst(title: string) {
    const res = await f.app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(f.token) },
      body: JSON.stringify({ title }),
    });
    return ((await res.json()) as any).data;
  }

  it('GET /:id/versions → lists all versions in descending order', async () => {
    const est = await createEst('Versioned');

    // Manually create a second version via the POST endpoint
    await f.app.request(`/${est.id}/versions`, {
      method: 'POST',
      headers: authHeader(f.token),
    });

    const res = await f.app.request(`/${est.id}/versions`, { headers: authHeader(f.token) });
    expect(res.status).toBe(200);
    const versions = ((await res.json()) as any).data;
    expect(versions).toHaveLength(2);
    // Descending order — version 2 first
    expect(versions[0].version).toBe(2);
    expect(versions[1].version).toBe(1);
  });

  it('POST /:id/versions → copies questions from current version', async () => {
    const est = await createEst('Copy Q');

    // Put questions on v1
    await f.app.request(`/${est.id}/questions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeader(f.token) },
      body: JSON.stringify({ questions: SAMPLE_QUESTIONS }),
    });

    // Fork
    const forkRes = await f.app.request(`/${est.id}/versions`, {
      method: 'POST',
      headers: authHeader(f.token),
    });
    expect(forkRes.status).toBe(201);
    const newVersion = ((await forkRes.json()) as any).data;
    expect(newVersion.version).toBe(2);
    expect(newVersion.questions).toHaveLength(1);
    expect(newVersion.questions[0].id).toBe('q1');
  });

  it('POST /:id/versions → sets estimator status back to draft', async () => {
    const est = await createEst('Fork from published');
    await f.app.request(`/${est.id}/publish`, { method: 'POST', headers: authHeader(f.token) });

    await f.app.request(`/${est.id}/versions`, { method: 'POST', headers: authHeader(f.token) });

    const getRes = await f.app.request(`/${est.id}`, { headers: authHeader(f.token) });
    expect(((await getRes.json()) as any).data.status).toBe('draft');
  });

  it('incrementing version numbers work across multiple forks', async () => {
    const est = await createEst('Multi fork');
    await f.app.request(`/${est.id}/versions`, { method: 'POST', headers: authHeader(f.token) });
    await f.app.request(`/${est.id}/versions`, { method: 'POST', headers: authHeader(f.token) });

    const res = await f.app.request(`/${est.id}/versions`, { headers: authHeader(f.token) });
    const versions = ((await res.json()) as any).data;
    expect(versions).toHaveLength(3);
    expect(versions[0].version).toBe(3);
  });
});

// ── Embed code ────────────────────────────────────────────────────────────────

describe('embed code', () => {
  let f: Fixtures;
  beforeEach(async () => { f = await setup(); });

  it('GET /:id/embed-code → returns snippet with publicKey', async () => {
    const createRes = await f.app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader(f.token) },
      body: JSON.stringify({ title: 'Embed Me' }),
    });
    const { data: est } = (await createRes.json()) as any;

    const res = await f.app.request(`/${est.id}/embed-code`, { headers: authHeader(f.token) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.publicKey).toBe(est.publicKey);
    expect(body.data.snippet).toContain(`data-key="${est.publicKey}"`);
    expect(body.data.snippet).toContain('widget.iife.js');
  });

  it('GET /:id/embed-code → 404 for unknown estimator', async () => {
    const res = await f.app.request('/no-such-id/embed-code', { headers: authHeader(f.token) });
    expect(res.status).toBe(404);
  });
});
