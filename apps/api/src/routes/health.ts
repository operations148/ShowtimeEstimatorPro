import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { db } from '../models/db';
import { env } from '../env';

const APP_VERSION = '0.0.1';

export const healthRoutes = new Hono();

healthRoutes.get('/', async (c) => {
  const uptime = Math.floor(process.uptime());

  let dbStatus: 'connected' | 'disconnected' = 'connected';
  try {
    await db.execute(sql`SELECT 1`);
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
