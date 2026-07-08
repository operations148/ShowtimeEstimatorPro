import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '../env';
import * as schema from './schema';

// Supabase (and any hosted Postgres) requires SSL. Local Postgres does not.
const needsSsl = !/localhost|127\.0\.0\.1/.test(env.DATABASE_URL);

// Reuse a single Pool across hot-reloads (dev) and warm serverless invocations
// (Vercel) to avoid exhausting Supabase's connection limit. We cache the pool on
// globalThis in ALL environments (including production) so warm serverless
// invocations reuse the same pool instead of leaking a new one per module load.
const globalForDb = globalThis as unknown as { __pgPool?: Pool };

const pool =
  globalForDb.__pgPool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
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
