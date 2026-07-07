// Vercel serverless entrypoint for the Hono API.
// The Hono app (src/app.ts) is framework-agnostic and mounts all routes under
// /api/v1; here we wrap it with Vercel's Node adapter. vercel.json rewrites every
// path to this function, and Hono routes internally by the original URL.
//
// NOTE: We use @hono/node-server's getRequestListener, NOT hono/vercel's handle().
// hono/vercel's handle() is `(req) => app.fetch(req)` — a single-argument function
// that assumes `req` is already a WHATWG Request. Vercel's Node.js runtime (required
// here for `pg`/node-postgres, which doesn't run on Edge) invokes the default export
// with the classic (req, res) Node convention, where `req` is a raw IncomingMessage
// (plain-object .headers, no .get()). That mismatch crashed every request inside
// Hono's requestId() middleware and left the response hanging until Vercel's function
// timeout. getRequestListener bridges Node's (req, res) into app.fetch correctly and
// writes the resulting Response back onto `res`.
import { getRequestListener } from '@hono/node-server';
import { app } from '../src/app';

export const config = { runtime: 'nodejs' };

export default getRequestListener(app.fetch);
