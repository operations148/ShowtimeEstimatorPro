// Vercel serverless entrypoint for the Hono API.
// The Hono app (src/app.ts) is framework-agnostic and mounts all routes under
// /api/v1; here we bridge Vercel's Node (req, res) invocation into app.fetch.
// vercel.json rewrites every path to this function, and Hono routes internally
// by the original URL.
//
// WHY A CUSTOM BRIDGE (and not hono/vercel's handle() or @hono/node-server's
// getRequestListener):
//   - hono/vercel's handle() is `(req) => app.fetch(req)` — an Edge-style single-arg
//     function that assumes `req` is already a WHATWG Request. Vercel's Node.js runtime
//     (required here for `pg`/node-postgres, which can't run on Edge) invokes the default
//     export with the classic (req, res) convention. Incompatible.
//   - getRequestListener bridges (req, res) correctly for a *plain* Node server, but it
//     reads the request body by lazily streaming the IncomingMessage. Vercel's runtime
//     pre-consumes that stream (its body-parsing helper drains it before our handler
//     runs), so the lazy read never receives the body chunks and `c.req.json()` hangs
//     forever on every POST/PUT/PATCH. GET has no body, so GET was unaffected — which is
//     exactly the production symptom (see honojs/node-server#306).
//
// ROOT-CAUSE FIX: fully buffer the request body from the (already-consumable or
// pre-parsed) stream BEFORE constructing the WHATWG Request, so app.fetch gets the
// complete body synchronously and never awaits a stream that will never emit.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { app } from '../src/app';

export const config = { runtime: 'nodejs' };

export default async function handler(
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse,
) {
  try {
    const method = (req.method ?? 'GET').toUpperCase();
    const proto = (req.headers['x-forwarded-proto'] as string) ?? 'https';
    const url = `${proto}://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`;

    // Root-cause fix: fully buffer the body BEFORE building the Request.
    let body: Buffer | undefined;
    if (method !== 'GET' && method !== 'HEAD') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      if (chunks.length) body = Buffer.concat(chunks);
      else if (req.body != null) {
        const b = req.body;
        body = Buffer.isBuffer(b) ? b : Buffer.from(typeof b === 'string' ? b : JSON.stringify(b));
      }
    }

    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
      else if (v != null) headers.set(k, v);
    }

    const response = await app.fetch(
      new Request(url, { method, headers, body, ...(body ? { duplex: 'half' } : {}) } as RequestInit),
    );

    res.statusCode = response.status;
    // CRITICAL: emit multiple Set-Cookie headers separately (session + csrf) — never coalesce.
    const cookies =
      (response.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() !== 'set-cookie') res.setHeader(key, value);
    });
    if (cookies.length) res.setHeader('set-cookie', cookies);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      data: null,
      error: { code: 'HANDLER_ERROR', message: (err as Error)?.message ?? 'Unknown error' },
    }));
  }
}
