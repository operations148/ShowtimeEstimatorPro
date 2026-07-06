import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '../env';
import * as schema from './schema';

// Supabase (and any hosted Postgres) requires SSL. Local Postgres does not.
const needsSsl = !/localhost|127\.0\.0\.1/.test(env.DATABASE_URL);

// Reuse a single Pool across hot-reloads (dev) and warm serverless invocations
// (Vercel) to avoid exhausting Supabase's connection limit. On serverless we keep
// the pool tiny since each function instance holds its own.
const globalForDb = globalThis as unknown as { __pgPool?: Pool };

const pool =
  globalForDb.__pgPool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    max: env.NODE_ENV === 'production' ? 1 : 5,
  });

if (env.NODE_ENV !== 'production') globalForDb.__pgPool = pool;

export const db = drizzle(pool, { schema });
export type Database = typeof db;
export { pool };
