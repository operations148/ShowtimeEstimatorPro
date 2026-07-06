// Vercel serverless entrypoint for the Hono API.
// The Hono app (src/app.ts) is framework-agnostic and mounts all routes under
// /api/v1; here we wrap it with Vercel's Node adapter. vercel.json rewrites every
// path to this function, and Hono routes internally by the original URL.
import { handle } from 'hono/vercel';
import { app } from '../src/app';

export const config = { runtime: 'nodejs' };

export default handle(app);
