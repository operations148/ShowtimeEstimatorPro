/**
 * Startup validation — runs once before the HTTP server binds.
 *
 * Checks (in order):
 *   1. Environment variables — validated by env.ts at import time; if we reach
 *      this function, all required vars are already confirmed present and typed.
 *   2. Database connectivity — ensures the DB file/connection is reachable.
 *   3. Provider adapters — instantiates each configured provider to catch
 *      missing credentials or misconfigurations before the first request arrives.
 *
 * Any check failure logs a fatal message and exits with code 1 so that the
 * process supervisor (Docker, Railway, systemd, PM2) knows to restart or alert.
 */

import { sql } from 'drizzle-orm';
import { createEmailProvider, createSmsProvider, createPaymentProvider } from '@repo/provider-adapters';
import { db } from './models/db';
import { env } from './env';
import { logger } from './lib/logger';

const APP_VERSION = '0.0.1';

export async function validateStartup(): Promise<void> {
  logger.info(
    { version: APP_VERSION, nodeEnv: env.NODE_ENV, port: env.PORT },
    'starting API server — running startup checks',
  );

  // ── 1. Environment variables ─────────────────────────────────────────────
  // env.ts calls process.exit(1) on failure, so if we are here they are valid.
  logger.info('startup: environment variables OK');

  // ── 2. Database connectivity ─────────────────────────────────────────────
  try {
    await db.execute(sql`SELECT 1`);
    logger.info({ url: env.DATABASE_URL }, 'startup: database connectivity OK');
  } catch (err) {
    logger.fatal({ err, url: env.DATABASE_URL }, 'startup: database connection failed — cannot start');
    process.exit(1);
  }

  // ── 3. Provider adapters ─────────────────────────────────────────────────
  const providerChecks: Array<{ label: string; init: () => unknown }> = [
    {
      label: `email:${env.EMAIL_PROVIDER}`,
      init: () => createEmailProvider(env.EMAIL_PROVIDER),
    },
    {
      label: `sms:${env.SMS_PROVIDER}`,
      init: () => createSmsProvider(env.SMS_PROVIDER),
    },
    {
      label: `payment:${env.PAYMENT_PROVIDER}`,
      init: () => createPaymentProvider(env.PAYMENT_PROVIDER),
    },
  ];

  for (const { label, init } of providerChecks) {
    try {
      init();
      logger.info({ provider: label }, 'startup: provider adapter OK');
    } catch (err) {
      logger.fatal(
        { err, provider: label },
        'startup: provider adapter initialization failed — cannot start',
      );
      process.exit(1);
    }
  }

  logger.info(
    { version: APP_VERSION, nodeEnv: env.NODE_ENV },
    'startup: all checks passed',
  );
}
