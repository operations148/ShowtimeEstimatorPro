import { describe, it, expect, beforeEach } from 'vitest';
import { fileURLToPath } from 'url';
import path from 'path';
import * as jose from 'jose';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { SESSION_COOKIE_NAME } from '@repo/shared';
import { AnalyticsService } from '../../services/analytics.service';
import { createAnalyticsRoutes } from '../analytics';
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

// Seed helpers
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
    .values({ tenantId, email: `user-${Date.now()}-${Math.random()}@test.com`, role })
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

function seedSubmission(
  db: BetterSQLite3Database<typeof schema>,
  opts: {
    tenantId: string;
    estimatorId: string;
    estimateMin: number;
    estimateMax: number;
    createdAt?: Date;
  },
) {
  const [s] = db
    .insert(schema.submissions)
    .values({
      tenantId: opts.tenantId,
      estimatorId: opts.estimatorId,
      versionId: 'v1',
      leadEmail: `lead-${Date.now()}-${Math.random()}@test.com`,
      leadZip: '94103',
      answers: {},
      estimateMin: opts.estimateMin,
      estimateMax: opts.estimateMax,
      createdAt: opts.createdAt ?? new Date(),
    })
    .returning()
    .all();
  return s!;
}

function seedEvent(
  db: BetterSQLite3Database<typeof schema>,
  opts: {
    tenantId: string;
    estimatorId: string;
    eventType: 'step_view' | 'step_complete' | string;
    stepId?: string;
    sessionId?: string;
    createdAt?: Date;
  },
) {
  db.insert(schema.analyticsEvents)
    .values({
      tenantId: opts.tenantId,
      estimatorId: opts.estimatorId,
      eventType: opts.eventType,
      stepId: opts.stepId,
      sessionId: opts.sessionId ?? 'sess-' + Math.random(),
      createdAt: opts.createdAt ?? new Date(),
    })
    .run();
}

// ── AnalyticsService unit tests ───────────────────────────────────────────────

describe('AnalyticsService.getSummary', () => {
  let db: BetterSQLite3Database<typeof schema>;
  let svc: AnalyticsService;
  let tenantId: string;
  let estimatorId: string;

  beforeEach(() => {
    db = createTestDb();
    svc = new AnalyticsService(db);
    const tenant = seedTenant(db, 'analytics-test-' + Date.now());
    tenantId = tenant.id;
    const est = seedEstimator(db, tenantId);
    estimatorId = est.id;
  });

  it('returns zeros when no data', () => {
    const summary = svc.getSummary(tenantId);
    expect(summary.totalSubmissions).toBe(0);
    expect(summary.totalEstimatedRevenue).toBe(0);
    expect(summary.averageEstimate).toBe(0);
    expect(summary.submissionsOverTime).toEqual([]);
    expect(summary.revenueOverTime).toEqual([]);
    expect(summary.dropOffByStep).toEqual([]);
  });

  it('counts totalSubmissions correctly', () => {
    seedSubmission(db, { tenantId, estimatorId, estimateMin: 1000, estimateMax: 2000 });
    seedSubmission(db, { tenantId, estimatorId, estimateMin: 3000, estimateMax: 5000 });
    seedSubmission(db, { tenantId, estimatorId, estimateMin: 500, estimateMax: 1500 });

    const summary = svc.getSummary(tenantId);
    expect(summary.totalSubmissions).toBe(3);
  });

  it('computes totalEstimatedRevenue as sum of midpoints', () => {
    // midpoints: 1500, 4000, 1000 → sum = 6500
    seedSubmission(db, { tenantId, estimatorId, estimateMin: 1000, estimateMax: 2000 });
    seedSubmission(db, { tenantId, estimatorId, estimateMin: 3000, estimateMax: 5000 });
    seedSubmission(db, { tenantId, estimatorId, estimateMin: 500, estimateMax: 1500 });

    const summary = svc.getSummary(tenantId);
    expect(summary.totalEstimatedRevenue).toBe(6500);
  });

  it('computes averageEstimate as integer average of midpoints', () => {
    // midpoints: 1500, 4000, 1000 → avg = 6500/3 ≈ 2166
    seedSubmission(db, { tenantId, estimatorId, estimateMin: 1000, estimateMax: 2000 });
    seedSubmission(db, { tenantId, estimatorId, estimateMin: 3000, estimateMax: 5000 });
    seedSubmission(db, { tenantId, estimatorId, estimateMin: 500, estimateMax: 1500 });

    const summary = svc.getSummary(tenantId);
    expect(summary.averageEstimate).toBe(2166);
  });

  it('groups submissionsOverTime by calendar date', () => {
    const day1 = new Date('2025-06-01T10:00:00Z');
    const day2 = new Date('2025-06-02T14:30:00Z');

    seedSubmission(db, { tenantId, estimatorId, estimateMin: 1000, estimateMax: 2000, createdAt: day1 });
    seedSubmission(db, { tenantId, estimatorId, estimateMin: 1000, estimateMax: 2000, createdAt: day1 });
    seedSubmission(db, { tenantId, estimatorId, estimateMin: 2000, estimateMax: 4000, createdAt: day2 });

    const summary = svc.getSummary(tenantId);
    expect(summary.submissionsOverTime).toHaveLength(2);

    const d1 = summary.submissionsOverTime.find((r) => r.date === '2025-06-01');
    const d2 = summary.submissionsOverTime.find((r) => r.date === '2025-06-02');
    expect(d1?.count).toBe(2);
    expect(d2?.count).toBe(1);
  });

  it('groups revenueOverTime by calendar date', () => {
    const day1 = new Date('2025-06-01T10:00:00Z');
    const day2 = new Date('2025-06-02T14:30:00Z');

    // day1: midpoints 1500 + 1500 = 3000; day2: midpoint 3000
    seedSubmission(db, { tenantId, estimatorId, estimateMin: 1000, estimateMax: 2000, createdAt: day1 });
    seedSubmission(db, { tenantId, estimatorId, estimateMin: 1000, estimateMax: 2000, createdAt: day1 });
    seedSubmission(db, { tenantId, estimatorId, estimateMin: 2000, estimateMax: 4000, createdAt: day2 });

    const summary = svc.getSummary(tenantId);
    const d1 = summary.revenueOverTime.find((r) => r.date === '2025-06-01');
    const d2 = summary.revenueOverTime.find((r) => r.date === '2025-06-02');
    expect(d1?.revenue).toBe(3000);
    expect(d2?.revenue).toBe(3000);
  });

  it('computes dropOffByStep rates correctly', () => {
    // step_1: 3 views, 2 completions → dropOffRate = (3-2)/3 ≈ 0.33
    seedEvent(db, { tenantId, estimatorId, eventType: 'step_view', stepId: 'step_1' });
    seedEvent(db, { tenantId, estimatorId, eventType: 'step_view', stepId: 'step_1' });
    seedEvent(db, { tenantId, estimatorId, eventType: 'step_view', stepId: 'step_1' });
    seedEvent(db, { tenantId, estimatorId, eventType: 'step_complete', stepId: 'step_1' });
    seedEvent(db, { tenantId, estimatorId, eventType: 'step_complete', stepId: 'step_1' });

    // step_2: 2 views, 0 completions → dropOffRate = 1.0
    seedEvent(db, { tenantId, estimatorId, eventType: 'step_view', stepId: 'step_2' });
    seedEvent(db, { tenantId, estimatorId, eventType: 'step_view', stepId: 'step_2' });

    const summary = svc.getSummary(tenantId);
    expect(summary.dropOffByStep).toHaveLength(2);

    const s1 = summary.dropOffByStep.find((r) => r.stepId === 'step_1');
    expect(s1?.views).toBe(3);
    expect(s1?.completions).toBe(2);
    expect(s1?.dropOffRate).toBeCloseTo(0.33, 2);

    const s2 = summary.dropOffByStep.find((r) => r.stepId === 'step_2');
    expect(s2?.views).toBe(2);
    expect(s2?.completions).toBe(0);
    expect(s2?.dropOffRate).toBe(1);
  });

  it('dropOffRate is 0 when all steps completed', () => {
    seedEvent(db, { tenantId, estimatorId, eventType: 'step_view', stepId: 'step_1' });
    seedEvent(db, { tenantId, estimatorId, eventType: 'step_complete', stepId: 'step_1' });

    const summary = svc.getSummary(tenantId);
    const s1 = summary.dropOffByStep.find((r) => r.stepId === 'step_1');
    expect(s1?.dropOffRate).toBe(0);
  });

  it('does NOT include events without a stepId in dropOffByStep', () => {
    seedEvent(db, { tenantId, estimatorId, eventType: 'step_view' }); // no stepId
    seedEvent(db, { tenantId, estimatorId, eventType: 'widget_load' }); // different type

    const summary = svc.getSummary(tenantId);
    expect(summary.dropOffByStep).toHaveLength(0);
  });

  it('tenant isolation — does not include another tenant\'s submissions', () => {
    const other = seedTenant(db, 'other-' + Date.now());
    const otherEst = seedEstimator(db, other.id);
    seedSubmission(db, { tenantId: other.id, estimatorId: otherEst.id, estimateMin: 99000, estimateMax: 100000 });

    const summary = svc.getSummary(tenantId);
    expect(summary.totalSubmissions).toBe(0);
    expect(summary.totalEstimatedRevenue).toBe(0);
  });

  it('tenant isolation — does not include another tenant\'s events in dropOffByStep', () => {
    const other = seedTenant(db, 'other-evt-' + Date.now());
    const otherEst = seedEstimator(db, other.id);
    seedEvent(db, { tenantId: other.id, estimatorId: otherEst.id, eventType: 'step_view', stepId: 'step_x' });

    const summary = svc.getSummary(tenantId);
    expect(summary.dropOffByStep).toHaveLength(0);
  });

  // ── Date range filtering ───────────────────────────────────────────────────

  it('from filter excludes submissions before the date', () => {
    const before = new Date('2025-05-01T00:00:00Z');
    const after = new Date('2025-06-15T00:00:00Z');

    seedSubmission(db, { tenantId, estimatorId, estimateMin: 1000, estimateMax: 2000, createdAt: before });
    seedSubmission(db, { tenantId, estimatorId, estimateMin: 3000, estimateMax: 5000, createdAt: after });

    const summary = svc.getSummary(tenantId, { from: new Date('2025-06-01T00:00:00Z') });
    expect(summary.totalSubmissions).toBe(1);
    expect(summary.totalEstimatedRevenue).toBe(4000);
  });

  it('to filter excludes submissions after the date', () => {
    const before = new Date('2025-05-01T00:00:00Z');
    const after = new Date('2025-06-15T00:00:00Z');

    seedSubmission(db, { tenantId, estimatorId, estimateMin: 1000, estimateMax: 2000, createdAt: before });
    seedSubmission(db, { tenantId, estimatorId, estimateMin: 3000, estimateMax: 5000, createdAt: after });

    const summary = svc.getSummary(tenantId, { to: new Date('2025-06-01T00:00:00Z') });
    expect(summary.totalSubmissions).toBe(1);
    expect(summary.totalEstimatedRevenue).toBe(1500);
  });

  it('from+to range returns only submissions within the window', () => {
    seedSubmission(db, { tenantId, estimatorId, estimateMin: 100, estimateMax: 200, createdAt: new Date('2025-04-01T00:00:00Z') });
    seedSubmission(db, { tenantId, estimatorId, estimateMin: 1000, estimateMax: 2000, createdAt: new Date('2025-06-15T00:00:00Z') });
    seedSubmission(db, { tenantId, estimatorId, estimateMin: 9000, estimateMax: 10000, createdAt: new Date('2025-09-01T00:00:00Z') });

    const summary = svc.getSummary(tenantId, {
      from: new Date('2025-06-01T00:00:00Z'),
      to: new Date('2025-07-31T00:00:00Z'),
    });
    expect(summary.totalSubmissions).toBe(1);
    expect(summary.totalEstimatedRevenue).toBe(1500);
  });

  // ── estimatorId filtering ──────────────────────────────────────────────────

  it('estimatorId filter returns only that estimator\'s submissions', () => {
    const est2 = seedEstimator(db, tenantId);

    seedSubmission(db, { tenantId, estimatorId, estimateMin: 1000, estimateMax: 2000 });
    seedSubmission(db, { tenantId, estimatorId: est2.id, estimateMin: 5000, estimateMax: 7000 });

    const summary = svc.getSummary(tenantId, { estimatorId });
    expect(summary.totalSubmissions).toBe(1);
    expect(summary.totalEstimatedRevenue).toBe(1500);
  });

  it('estimatorId filter applies to dropOffByStep as well', () => {
    const est2 = seedEstimator(db, tenantId);

    // est1: step_view
    seedEvent(db, { tenantId, estimatorId, eventType: 'step_view', stepId: 'step_1' });
    // est2: step_view for different step — must not appear when filtered to est1
    seedEvent(db, { tenantId, estimatorId: est2.id, eventType: 'step_view', stepId: 'step_99' });

    const summary = svc.getSummary(tenantId, { estimatorId });
    expect(summary.dropOffByStep).toHaveLength(1);
    expect(summary.dropOffByStep[0]!.stepId).toBe('step_1');
  });

  // ── track() ───────────────────────────────────────────────────────────────

  it('track() inserts an analytics event', () => {
    svc.track({ tenantId, estimatorId, eventType: 'widget_load', sessionId: 'sess-1' });
    const rows = db.select().from(schema.analyticsEvents).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.eventType).toBe('widget_load');
  });
});

// ── Analytics route integration tests ────────────────────────────────────────

describe('analytics routes', () => {
  let db: BetterSQLite3Database<typeof schema>;
  let app: ReturnType<typeof createAnalyticsRoutes>;
  let tenantId: string;
  let estimatorId: string;
  let ownerToken: string;

  beforeEach(async () => {
    db = createTestDb();
    app = createAnalyticsRoutes(db);

    const tenant = seedTenant(db, 'route-test-' + Date.now());
    tenantId = tenant.id;
    const user = seedUser(db, tenantId);
    const est = seedEstimator(db, tenantId);
    estimatorId = est.id;
    ownerToken = await signToken({ sub: user.id, tenantId, role: 'owner' });
  });

  describe('GET /summary', () => {
    it('returns 200 with correct totals', async () => {
      seedSubmission(db, { tenantId, estimatorId, estimateMin: 2000, estimateMax: 4000 });

      const res = await app.request('/summary', { headers: authHeader(ownerToken) });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.data.totalSubmissions).toBe(1);
      expect(body.data.totalEstimatedRevenue).toBe(3000);
    });

    it('unauthenticated → 401', async () => {
      const res = await app.request('/summary');
      expect(res.status).toBe(401);
    });

    it('invalid from date → 400', async () => {
      const res = await app.request('/summary?from=not-a-date', {
        headers: authHeader(ownerToken),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('VALIDATION');
    });

    it('invalid to date → 400', async () => {
      const res = await app.request('/summary?to=bad', {
        headers: authHeader(ownerToken),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as any;
      expect(body.error.code).toBe('VALIDATION');
    });

    it('from query param filters by date', async () => {
      seedSubmission(db, {
        tenantId, estimatorId, estimateMin: 100, estimateMax: 200,
        createdAt: new Date('2025-01-01T00:00:00Z'),
      });
      seedSubmission(db, {
        tenantId, estimatorId, estimateMin: 1000, estimateMax: 2000,
        createdAt: new Date('2025-12-01T00:00:00Z'),
      });

      const res = await app.request('/summary?from=2025-06-01', {
        headers: authHeader(ownerToken),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.data.totalSubmissions).toBe(1);
    });

    it('estimatorId query param filters by estimator', async () => {
      const est2 = seedEstimator(db, tenantId);
      seedSubmission(db, { tenantId, estimatorId, estimateMin: 1000, estimateMax: 2000 });
      seedSubmission(db, { tenantId, estimatorId: est2.id, estimateMin: 5000, estimateMax: 9000 });

      const res = await app.request(`/summary?estimatorId=${estimatorId}`, {
        headers: authHeader(ownerToken),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.data.totalSubmissions).toBe(1);
      expect(body.data.totalEstimatedRevenue).toBe(1500);
    });

    it('response shape includes all required fields', async () => {
      const res = await app.request('/summary', { headers: authHeader(ownerToken) });
      const body = (await res.json()) as any;
      expect(body.data).toHaveProperty('totalSubmissions');
      expect(body.data).toHaveProperty('totalEstimatedRevenue');
      expect(body.data).toHaveProperty('averageEstimate');
      expect(body.data).toHaveProperty('submissionsOverTime');
      expect(body.data).toHaveProperty('revenueOverTime');
      expect(body.data).toHaveProperty('dropOffByStep');
      expect(Array.isArray(body.data.submissionsOverTime)).toBe(true);
      expect(Array.isArray(body.data.revenueOverTime)).toBe(true);
      expect(Array.isArray(body.data.dropOffByStep)).toBe(true);
    });
  });

  describe('POST /events', () => {
    it('tracks a valid event → 200', async () => {
      const res = await app.request('/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          estimatorId,
          eventType: 'step_view',
          stepId: 'step_1',
          sessionId: 'sess-abc',
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.data.tracked).toBe(true);

      const events = db.select().from(schema.analyticsEvents).all();
      expect(events).toHaveLength(1);
      expect(events[0]!.eventType).toBe('step_view');
    });

    it('missing required fields → 400', async () => {
      const res = await app.request('/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventType: 'step_view' }),
      });
      expect(res.status).toBe(400);
    });
  });
});
