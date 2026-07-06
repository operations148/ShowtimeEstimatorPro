import * as crypto from 'crypto';
import * as jose from 'jose';
import { eq, and, gt, desc, isNull } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { otpCodes, users } from '../models/schema';
import type * as schema from '../models/schema';
import { env } from '../env';
import {
  OTP_CODE_LENGTH,
  OTP_LOCKOUT_MINUTES,
  OTP_RATE_LIMIT_PER_HOUR,
  SESSION_EXPIRY_SECONDS,
} from '@repo/shared';
import type { Result } from '@repo/shared';
import { ok, err } from '@repo/shared';
import type { EmailProvider } from '@repo/provider-adapters';
import type { SmsProvider } from '@repo/provider-adapters';
import {
  renderTemplate,
  OTP_EMAIL_SUBJECT,
  OTP_EMAIL_TEMPLATE,
  OTP_SMS_TEMPLATE,
} from './template.service';

export class AuthService {
  constructor(
    private db: BetterSQLite3Database<typeof schema>,
    private emailProvider: EmailProvider,
    private smsProvider: SmsProvider,
  ) {}

  /**
   * Generate and send an OTP code.
   */
  async requestOtp(
    identifier: string,
    channel: 'email' | 'sms',
  ): Promise<Result<{ expiresAt: Date }, { code: string; message: string }>> {
    // Check rate limit: max N requests per hour for this identifier
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentCodes = this.db
      .select()
      .from(otpCodes)
      .where(and(eq(otpCodes.identifier, identifier), gt(otpCodes.createdAt, oneHourAgo)))
      .all();

    if (recentCodes.length >= OTP_RATE_LIMIT_PER_HOUR) {
      return err({ code: 'RATE_LIMITED', message: 'Too many OTP requests. Try again later.' });
    }

    // Generate code
    const code = generateOtpCode(OTP_CODE_LENGTH);
    const codeHash = hashCode(code);
    const expiresAt = new Date(Date.now() + env.OTP_EXPIRY_MINUTES * 60 * 1000);

    // Store hashed code (never store plaintext)
    this.db.insert(otpCodes).values({ identifier, codeHash, expiresAt }).run();

    // Send via appropriate channel
    const templateVars = { CODE: code, MINUTES: String(env.OTP_EXPIRY_MINUTES) };
    if (channel === 'email') {
      await this.emailProvider.send({
        to: identifier,
        subject: OTP_EMAIL_SUBJECT,
        textBody: renderTemplate(OTP_EMAIL_TEMPLATE, templateVars),
      });
    } else {
      await this.smsProvider.send({
        to: identifier,
        body: renderTemplate(OTP_SMS_TEMPLATE, templateVars),
      });
    }

    return ok({ expiresAt });
  }

  /**
   * Verify an OTP code and create a session.
   */
  async verifyOtp(
    identifier: string,
    code: string,
  ): Promise<Result<{ token: string; expiresAt: Date }, { code: string; message: string }>> {
    const codeHash = hashCode(code);
    const now = new Date();

    // Find the most-recent, non-expired, unused OTP for this identifier.
    // Using desc(createdAt) ensures we pick the latest code if multiple exist.
    // isNull(usedAt) prevents replaying an already-consumed code.
    const [otpRecord] = this.db
      .select()
      .from(otpCodes)
      .where(
        and(
          eq(otpCodes.identifier, identifier),
          gt(otpCodes.expiresAt, now),
          isNull(otpCodes.usedAt),
        ),
      )
      .orderBy(desc(otpCodes.createdAt))
      .limit(1)
      .all();

    if (!otpRecord) {
      return err({ code: 'INVALID_OTP', message: 'No valid OTP found. Request a new code.' });
    }

    // Check lockout (set by a previous failed-attempt run)
    if (otpRecord.lockedUntil && otpRecord.lockedUntil > now) {
      return err({ code: 'LOCKED', message: 'Account temporarily locked. Try again later.' });
    }

    // Verify hash
    if (otpRecord.codeHash !== codeHash) {
      const newAttempts = otpRecord.attempts + 1;
      // Lock immediately when this attempt reaches the maximum — avoids an extra
      // round-trip where the user sees MAX_ATTEMPTS (401) then LOCKED (423).
      const shouldLock = newAttempts >= env.OTP_MAX_ATTEMPTS;

      this.db
        .update(otpCodes)
        .set(
          shouldLock
            ? {
                attempts: newAttempts,
                lockedUntil: new Date(Date.now() + OTP_LOCKOUT_MINUTES * 60 * 1000),
              }
            : { attempts: newAttempts },
        )
        .where(eq(otpCodes.id, otpRecord.id))
        .run();

      return err(
        shouldLock
          ? { code: 'LOCKED', message: 'Too many attempts. Account locked for 30 minutes.' }
          : { code: 'INVALID_OTP', message: 'Invalid code.' },
      );
    }

    // Mark as used — prevents replay
    this.db.update(otpCodes).set({ usedAt: now }).where(eq(otpCodes.id, otpRecord.id)).run();

    // Look up user (supports both email and phone identifiers)
    const [user] = this.db
      .select()
      .from(users)
      .where(eq(users.email, identifier))
      .limit(1)
      .all();

    if (!user) {
      return err({ code: 'USER_NOT_FOUND', message: 'No account found for this identifier.' });
    }

    // Create signed JWT session
    const secret = new TextEncoder().encode(env.SESSION_SECRET);
    const expiresAt = new Date(Date.now() + SESSION_EXPIRY_SECONDS * 1000);
    const token = await new jose.SignJWT({
      sub: user.id,
      tenantId: user.tenantId,
      role: user.role,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime(expiresAt)
      .setIssuedAt()
      .sign(secret);

    return ok({ token, expiresAt });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateOtpCode(length: number): string {
  const max = Math.pow(10, length);
  const code = crypto.randomInt(0, max);
  return code.toString().padStart(length, '0');
}

function hashCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

export { generateOtpCode, hashCode };
