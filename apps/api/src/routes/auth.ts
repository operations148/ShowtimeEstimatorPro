import { Hono } from 'hono';
import { setCookie, getCookie } from 'hono/cookie';
import { randomUUID } from 'crypto';
import { SignJWT, jwtVerify } from 'jose';
import { eq } from 'drizzle-orm';
import {
  otpRequestSchema,
  otpVerifySchema,
  SESSION_COOKIE_NAME,
  SESSION_EXPIRY_SECONDS,
} from '@repo/shared';
import { AuthService } from '../services/auth.service';
import { createEmailProvider, createSmsProvider } from '@repo/provider-adapters';
import { env } from '../env';
import { db } from '../models/db';
import { users, tenants } from '../models/schema';
import { stripHtml } from '../utils/sanitize';
import { rateLimit } from '../middleware/rate-limiter';

/**
 * Factory that wires up auth routes against a given AuthService.
 * Used directly in tests to inject mock providers and in-memory DB.
 */
export function createAuthRoutes(service: AuthService): Hono {
  const app = new Hono();

  app.post('/otp/request', async (c) => {
    const body = await c.req.json();
    const parsed = otpRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { data: null, error: { code: 'VALIDATION', message: parsed.error.message } },
        400,
      );
    }

    const result = await service.requestOtp(parsed.data.identifier, parsed.data.channel);
    if (!result.ok) {
      return c.json({ data: null, error: result.error }, 429);
    }

    return c.json({ data: { expiresAt: result.value.expiresAt }, error: null });
  });

  app.post('/otp/verify', async (c) => {
    const body = await c.req.json();
    const parsed = otpVerifySchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { data: null, error: { code: 'VALIDATION', message: parsed.error.message } },
        400,
      );
    }

    const result = await service.verifyOtp(parsed.data.identifier, parsed.data.code);
    if (!result.ok) {
      const status = result.error.code === 'LOCKED' ? 423 : 401;
      return c.json({ data: null, error: result.error }, status);
    }

    setCookie(c, SESSION_COOKIE_NAME, result.value.token, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: env.NODE_ENV === 'production' ? 'None' : 'Lax',
      path: '/',
      maxAge: SESSION_EXPIRY_SECONDS,
    });

    return c.json({ data: { expiresAt: result.value.expiresAt }, error: null });
  });

  // GET /csrf-token — issue a CSRF token via non-httpOnly cookie for double-submit pattern
  app.get('/csrf-token', (c) => {
    const token = randomUUID();
    setCookie(c, 'csrf_token', token, {
      httpOnly: false, // must be readable by client-side JS
      secure: env.NODE_ENV === 'production',
      sameSite: env.NODE_ENV === 'production' ? 'None' : 'Lax',
      path: '/',
      maxAge: 60 * 60, // 1 hour
    });
    return c.json({ data: { csrfToken: token }, error: null });
  });

  app.post('/logout', async (c) => {
    setCookie(c, SESSION_COOKIE_NAME, '', {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: env.NODE_ENV === 'production' ? 'None' : 'Lax',
      path: '/',
      maxAge: 0,
    });
    return c.json({ data: { message: 'Logged out' }, error: null });
  });

  // ── Google OAuth ────────────────────────────────────────────────────────────

  /**
   * GET /google
   * Redirects the browser to Google's OAuth consent screen.
   */
  app.get('/google', (c) => {
    if (!env.GOOGLE_CLIENT_ID) {
      return c.json(
        { data: null, error: { code: 'NOT_CONFIGURED', message: 'Google auth is not configured.' } },
        501,
      );
    }
    const state = randomUUID();
    const redirectUri =
      env.GOOGLE_REDIRECT_URI ?? 'http://localhost:4000/api/v1/auth/google/callback';
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      access_type: 'online',
      prompt: 'select_account',
    });
    setCookie(c, 'google_oauth_state', state, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: env.NODE_ENV === 'production' ? 'None' : 'Lax',
      path: '/',
      maxAge: 300, // 5 minutes
    });
    return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  });

  /**
   * GET /google/callback
   * Google redirects here after user authenticates.
   * - Existing user  → set session cookie → redirect to /dashboard
   * - New user       → set short-lived setup token → redirect to /signup
   */
  app.get('/google/callback', async (c) => {
    const dashboard = env.CORS_DASHBOARD_ORIGIN;
    const { code, state, error: oauthError } = c.req.query();
    const storedState = getCookie(c, 'google_oauth_state');

    // Clear state cookie regardless of outcome
    setCookie(c, 'google_oauth_state', '', { maxAge: 0, path: '/' });

    if (oauthError || !code || !state || state !== storedState) {
      return c.redirect(`${dashboard}/login?error=oauth_failed`);
    }

    // Exchange auth code for tokens
    const redirectUri =
      env.GOOGLE_REDIRECT_URI ?? 'http://localhost:4000/api/v1/auth/google/callback';
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID!,
        client_secret: env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      return c.redirect(`${dashboard}/login?error=oauth_failed`);
    }

    const tokenData = (await tokenRes.json()) as { access_token: string };

    // Get verified user info from Google
    const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!userInfoRes.ok) {
      return c.redirect(`${dashboard}/login?error=oauth_failed`);
    }

    const googleUser = (await userInfoRes.json()) as {
      email: string;
      name?: string;
      given_name?: string;
    };
    const email = googleUser.email.toLowerCase().trim();
    const displayName = googleUser.name ?? googleUser.given_name ?? '';

    const secret = new TextEncoder().encode(env.SESSION_SECRET);

    // Check if user already has an account
    const existingUser = (
      await db.select().from(users).where(eq(users.email, email)).limit(1)
    )[0];

    if (existingUser) {
      // Issue full session cookie
      const token = await new SignJWT({
        tenantId: existingUser.tenantId,
        role: existingUser.role,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(existingUser.id)
        .setExpirationTime(`${SESSION_EXPIRY_SECONDS}s`)
        .sign(secret);

      setCookie(c, SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: env.NODE_ENV === 'production' ? 'None' : 'Lax',
        path: '/',
        maxAge: SESSION_EXPIRY_SECONDS,
      });

      return c.redirect(`${dashboard}/dashboard`);
    }

    // New user — issue a short-lived setup token (5 min) containing their verified email
    const setupToken = await new SignJWT({ email, name: displayName })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('5m')
      .sign(secret);

    return c.redirect(
      `${dashboard}/signup?google_token=${encodeURIComponent(setupToken)}`,
    );
  });

  /**
   * POST /google/setup
   * Called from the /signup page when a brand-new Google user creates their org.
   * Verifies the setup token, creates tenant + user, issues session.
   */
  app.post('/google/setup', async (c) => {
    const body = (await c.req.json()) as { name?: string; slug?: string; googleToken?: string };
    const { name, slug, googleToken } = body;

    if (!name?.trim() || !slug?.trim() || !googleToken) {
      return c.json(
        { data: null, error: { code: 'VALIDATION', message: 'name, slug, and googleToken are required.' } },
        400,
      );
    }

    // Verify the Google setup token
    const secret = new TextEncoder().encode(env.SESSION_SECRET);
    let email: string;
    try {
      const { payload } = await jwtVerify(googleToken, secret);
      email = (payload.email as string).toLowerCase().trim();
    } catch {
      return c.json(
        { data: null, error: { code: 'INVALID_TOKEN', message: 'Setup link expired. Please sign in with Google again.' } },
        401,
      );
    }

    // Guard: user already exists
    const existingUser = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
    if (existingUser) {
      return c.json(
        { data: null, error: { code: 'CONFLICT', message: 'An account with this email already exists.' } },
        409,
      );
    }

    // Guard: slug taken
    const existingTenant = (
      await db.select().from(tenants).where(eq(tenants.slug, slug.trim())).limit(1)
    )[0];
    if (existingTenant) {
      return c.json(
        { data: null, error: { code: 'CONFLICT', message: 'That URL slug is already taken.' } },
        409,
      );
    }

    // Create tenant + owner user
    const [tenant] = await db
      .insert(tenants)
      .values({ name: stripHtml(name.trim()), slug: slug.trim() })
      .returning();

    const [owner] = await db
      .insert(users)
      .values({ tenantId: tenant!.id, email, role: 'owner' })
      .returning();

    // Issue full session cookie
    const sessionToken = await new SignJWT({
      tenantId: owner!.tenantId,
      role: 'owner',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(owner!.id)
      .setExpirationTime(`${SESSION_EXPIRY_SECONDS}s`)
      .sign(secret);

    setCookie(c, SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: env.NODE_ENV === 'production' ? 'None' : 'Lax',
      path: '/',
      maxAge: SESSION_EXPIRY_SECONDS,
    });

    return c.json({ data: { success: true }, error: null }, 201);
  });

  return app;
}

// ── Default export: real DB + providers + HTTP rate limiter ──────────────────

const authService = new AuthService(
  db,
  createEmailProvider(env.EMAIL_PROVIDER),
  createSmsProvider(env.SMS_PROVIDER),
);

export const authRoutes = new Hono();
// Auth limiters fail CLOSED (no failOpen) — a limiter outage must not enable brute force.
authRoutes.use('/otp/request', rateLimit({ windowMs: 60 * 60 * 1000, max: 10, keyPrefix: 'otp' }));
authRoutes.use('/otp/verify', rateLimit({ windowMs: 60 * 1000, max: 10, keyPrefix: 'otpv' }));
authRoutes.route('/', createAuthRoutes(authService));
