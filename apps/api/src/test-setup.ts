/**
 * Vitest global setup — runs before each test file, before any module imports.
 * Sets required env vars so env.ts passes Zod validation at module load time.
 */
process.env['SESSION_SECRET'] = 'test-secret-for-integration-tests-minimum-32-chars!!';
process.env['DATABASE_URL'] = ':memory:';
process.env['NODE_ENV'] = 'test';
