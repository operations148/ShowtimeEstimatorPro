// Root Vercel serverless entrypoint. Deploying from the repo root lets Vercel use
// pnpm + the workspace lockfile so the API's workspace deps (@repo/*) resolve.
// Re-export the handler from apps/api so hono/pg/etc. resolve in that package's
// node_modules context.
export { config, default } from '../apps/api/api/index';
