import { serve } from '@hono/node-server';
import { app } from './app';
import { env } from './env';
import { logger } from './lib/logger';
import { validateStartup } from './startup';

(async () => {
  await validateStartup();

  serve(
    {
      fetch: app.fetch,
      port: env.PORT,
    },
    (info) => {
      logger.info({ port: info.port }, `API server listening`);
    },
  );
})();
