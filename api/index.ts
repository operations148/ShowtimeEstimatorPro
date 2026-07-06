// Root Vercel serverless entrypoint. Deploying from the repo root lets Vercel use
// pnpm + the workspace lockfile so the API's workspace deps (@repo/*) resolve.
// Importing the handler as a value (not a re-export) forces the bundler to inline
// the whole app + its deps into this function.
import apiHandler from '../apps/api/api/index';

export const config = { runtime: 'nodejs' };

export default apiHandler;
