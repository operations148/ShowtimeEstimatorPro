import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { createRequire } from 'module';
import { db } from '../models/db';
import { env } from '../env';

const _require = createRequire(import.meta.url);
const { version: APP_VERSION } = _require('../../package.json') as { version: string };

export const healthRoutes = new Hono();

healthRoutes.get('/', async (c) => {
  const uptime = Math.floor(process.uptime());

  let dbStatus: 'connected' | 'disconnected' = 'connected';
  try {
    db.get(sql`SELECT 1`);
  } catch {
    dbStatus = 'disconnected';
  }

  const healthy = dbStatus === 'connected';

  return c.json(
    {
      data: {
        status: healthy ? 'ok' : 'degraded',
        version: APP_VERSION,
        nodeEnv: env.NODE_ENV,
        uptime,
        checks: {
          db: dbStatus,
        },
      },
      error: null,
    },
    healthy ? 200 : 503,
  );
});
