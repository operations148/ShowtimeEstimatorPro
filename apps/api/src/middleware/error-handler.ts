import type { ErrorHandler } from 'hono';
import { logger } from '../lib/logger';

export const errorHandler: ErrorHandler = (err, c) => {
  const requestId = c.get('requestId') as string | undefined;
  const reqLogger = requestId ? logger.child({ requestId }) : logger;

  reqLogger.error(
    { err: { message: err.message, stack: err.stack } },
    'unhandled error',
  );

  const status = 'status' in err && typeof err.status === 'number' ? err.status : 500;
  const code =
    status === 400 ? 'BAD_REQUEST'
    : status === 401 ? 'UNAUTHORIZED'
    : status === 403 ? 'FORBIDDEN'
    : status === 404 ? 'NOT_FOUND'
    : 'INTERNAL_ERROR';

  return c.json(
    {
      data: null,
      error: {
        code,
        message: status === 500 ? 'Internal server error' : err.message,
      },
    },
    status as any,
  );
};
