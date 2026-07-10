import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '../env';
import * as schema from './schema';

// Supabase (and any hosted Postgres) requires SSL. Local Postgres does not.
const needsSsl = !/localhost|127\.0\.0\.1/.test(env.DATABASE_URL);

// TLS to the database (M2). When DATABASE_CA is provided we VERIFY the server
// certificate against Supabase's CA (rejectUnauthorized: true), closing the MITM
// gap. Without a CA we fall back to encrypt-only (rejectUnauthorized: false) and
// warn at startup — set DATABASE_CA in production to fully close M2.
function dbSsl(): false | { rejectUnauthorized: boolean; ca?: string } {
  if (!needsSsl) return false;
  if (env.DATABASE_CA) return { ca: env.DATABASE_CA, rejectUnauthorized: true };
  if (env.NODE_ENV === 'production') {
    // eslint-disable-next-line no-console
    console.warn('[db] DATABASE_CA not set — DB TLS is encrypt-only (cert not verified). Set DATABASE_CA to enable full verification.');
  }
  return { rejectUnauthorized: false };
}

// Reuse a single Pool across hot-reloads (dev) and warm serverless invocations
// (Vercel) to avoid exhausting Supabase's connection limit. We cache the pool on
// globalThis in ALL environments (including production) so warm serverless
// invocations reuse the same pool instead of leaking a new one per module load.
const globalForDb = globalThis as unknown as { __pgPool?: Pool };

const pool =
  globalForDb.__pgPool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    ssl: dbSsl(),
    // Small pool per warm instance (each serverless instance holds its own), but >1
    // so concurrent DB calls within one request/instance don't serialize behind a
    // single connection. Timeouts ensure a stuck acquisition throws a catchable error
    // instead of hanging forever — critical since Vercel Runtime Logs are unavailable
    // on this plan, so an invisible infinite hang would otherwise be undiagnosable.
    max: 3,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000,
  });

globalForDb.__pgPool = pool;

export const db = drizzle(pool, { schema });
export type Database = typeof db;
export { pool };
