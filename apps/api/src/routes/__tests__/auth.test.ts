import { describe, it, expect, beforeEach } from 'vitest';
import { fileURLToPath } from 'url';
import path from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { MockEmailProvider, MockSmsProvider } from '@repo/provider-adapters';
import { SESSION_COOKIE_NAME, OTP_RATE_LIMIT_PER_HOUR } from '@repo/shared';
import { AuthService } from '../../services/auth.service';
import { createAuthRoutes } from '../auth';
import * as schema from '../../models/schema';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// apps/api/src/routes/__tests__  →  ../../.. = apps/api  →  apps/api/drizzle
const MIGRATIONS_FOLDER = path.resolve(__dirname, '../../../drizzle');

function createTestDb(): BetterSQLite3Database<typeof schema> {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

describe('auth routes', () => {
  let app: ReturnType<typeof createAuthRoutes>;
  let db: BetterSQLite3Database<typeof schema>;
  let mockEmail: MockEmailProvider;
  let mockSms: MockSmsProvider;

  beforeEach(() => {
    db = createTestDb();

    // Seed a tenant and user that the verifyOtp user-lookup requires
    const [tenant] = db
      .insert(schema.tenants)
      .values({ slug: 'test', name: 'Test Tenant' })
      .returning()
      .all();
    db.insert(schema.users)
      .values({
        tenantId: tenant!.id,
        email: 'test@example.com',
        name: 'Test User',
        role: 'owner',
      })
      .run();

    mockEmail = new MockEmailProvider();
    mockSms = new MockSmsProvider();
    const service = new AuthService(db, mockEmail, mockSms);
    app = createAuthRoutes(service);
  });

  it('POST /otp/request → 200 and delivers email', async () => {
    const res = await app.request('/otp/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'test@example.com', channel: 'email' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { expiresAt: string }; error: null };
    expect(body.data.expiresAt).toBeTruthy();
    expect(mockEmail.sentEmails).toHaveLength(1);
    expect(mockEmail.sentEmails[0]!.to).toBe('test@example.com');
  });

  it('correct code → 200 + sets session cookie', async () => {
    // Request OTP
    await app.request('/otp/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'test@example.com', channel: 'email' }),
    });

    // Extract the 6-digit code from the email body
    const textBody = mockEmail.sentEmails[0]!.textBody!;
    const match = textBody.match(/(\d{6})/);
    expect(match).not.toBeNull();
    const code = match![1]!;

    // Verify with the correct code
    const res = await app.request('/otp/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'test@example.com', code }),
    });

    expect(res.status).toBe(200);
    const setCookieHeader = res.headers.get('set-cookie');
    expect(setCookieHeader).toMatch(new RegExp(`${SESSION_COOKIE_NAME}=`));
    expect(setCookieHeader).toMatch(/HttpOnly/i);
  });

  it('wrong code → 401 and increments attempts on the OTP record', async () => {
    await app.request('/otp/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'test@example.com', channel: 'email' }),
    });

    const res = await app.request('/otp/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'test@example.com', code: '000000' }),
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as { data: null; error: { code: string } };
    expect(body.error.code).toBe('INVALID_OTP');

    // Confirm the attempt counter was incremented in the DB
    const [record] = db.select().from(schema.otpCodes).all();
    expect(record!.attempts).toBe(1);
  });

  it('max attempts → 423 locked on the Nth wrong code', async () => {
    // OTP_MAX_ATTEMPTS defaults to 5 (set via env default, confirmed in test-setup)
    const maxAttempts = 5;

    await app.request('/otp/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'test@example.com', channel: 'email' }),
    });

    let lastRes!: Response;
    for (let i = 0; i < maxAttempts; i++) {
      lastRes = await app.request('/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'test@example.com', code: '000000' }),
      });
    }

    expect(lastRes.status).toBe(423);
    const body = (await lastRes.json()) as { data: null; error: { code: string } };
    expect(body.error.code).toBe('LOCKED');
  });

  it('rate limited → 429 after OTP_RATE_LIMIT_PER_HOUR requests', async () => {
    // Exhaust the per-hour allowance
    for (let i = 0; i < OTP_RATE_LIMIT_PER_HOUR; i++) {
      await app.request('/otp/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'test@example.com', channel: 'email' }),
      });
    }

    // One more request should be rejected
    const res = await app.request('/otp/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'test@example.com', channel: 'email' }),
    });

    expect(res.status).toBe(429);
    const body = (await res.json()) as { data: null; error: { code: string } };
    expect(body.error.code).toBe('RATE_LIMITED');
  });
});
