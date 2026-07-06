import pino from 'pino';
import { env } from '../env';

/**
 * Structured JSON logger powered by pino.
 *
 * Log level is controlled by the LOG_LEVEL env var (default: 'info').
 * In development, pipe the server output through pino-pretty for human-readable logs:
 *
 *   pnpm --filter api dev | pnpm dlx pino-pretty
 *
 * Sensitive fields are automatically redacted from log output.
 * Never pass raw OTP codes, session tokens, or API keys as top-level log fields.
 */
export const logger = pino({
  level: env.LOG_LEVEL,

  // Redact sensitive paths anywhere in the logged object tree.
  // The censor '[REDACTED]' replaces the value before serialisation.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.token',
      '*.secret',
      '*.apiKey',
      '*.password',
      '*.codeHash',
    ],
    censor: '[REDACTED]',
  },

  // Include process-level metadata on every log line.
  base: {
    pid: process.pid,
    env: env.NODE_ENV,
  },
});

/**
 * Hono context type extension — allows c.get('logger') / c.set('logger', ...)
 * to be type-safe without wrapping every route file in a Variables generic.
 */
declare module 'hono' {
  interface ContextVariableMap {
    logger: pino.Logger;
  }
}
