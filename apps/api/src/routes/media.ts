import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth';
import { env } from '../env';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

export const mediaRoutes = new Hono();

// ── GET /media/image-search?q=...&per_page=9&page=1 ──────────────────────────

mediaRoutes.get('/image-search', requireAuth, async (c) => {
  const q = c.req.query('q')?.trim();
  const perPage = Math.min(Number(c.req.query('per_page') ?? '9'), 20);
  const page = Math.max(Number(c.req.query('page') ?? '1'), 1);

  if (!q) return c.json({ data: [], error: null });
  if (!env.UNSPLASH_ACCESS_KEY) return c.json({ data: [], error: null });

  const url = new URL('https://api.unsplash.com/search/photos');
  url.searchParams.set('query', q);
  url.searchParams.set('per_page', String(perPage));
  url.searchParams.set('page', String(page));
  url.searchParams.set('orientation', 'landscape');

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Client-ID ${env.UNSPLASH_ACCESS_KEY}` },
  });

  if (!res.ok) {
    return c.json({ data: [], error: { code: 'UNSPLASH_ERROR', message: 'Image search failed' } });
  }

  const json = (await res.json()) as {
    total_pages: number;
    results: Array<{
      id: string;
      description: string | null;
      alt_description: string | null;
      urls: { thumb: string; small: string; regular: string };
      links: { html: string };
    }>;
  };

  const data = json.results.map((p) => ({
    id: p.id,
    thumbUrl: p.urls.thumb,
    smallUrl: p.urls.small,
    regularUrl: p.urls.regular,
    description: p.description ?? p.alt_description ?? '',
    unsplashUrl: p.links.html,
  }));

  return c.json({ data, error: null, meta: { totalPages: json.total_pages, page } });
});

// ── POST /media/upload ────────────────────────────────────────────────────────
// Accepts multipart/form-data with a `file` field.
// Saves to public/uploads/{tenantId}/ and returns the accessible URL.

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 6 * 1024 * 1024; // 6 MB

mediaRoutes.post('/upload', requireAuth, async (c) => {
  const auth = c.get('auth');

  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json(
      { data: null, error: { code: 'BAD_REQUEST', message: 'Expected multipart/form-data' } },
      400,
    );
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return c.json({ data: null, error: { code: 'BAD_REQUEST', message: 'No file provided' } }, 400);
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return c.json(
      { data: null, error: { code: 'INVALID_FILE', message: 'Only PNG, JPEG, or WebP images are allowed' } },
      400,
    );
  }

  if (file.size > MAX_BYTES) {
    return c.json(
      { data: null, error: { code: 'FILE_TOO_LARGE', message: 'Image must be under 6 MB' } },
      400,
    );
  }

  const ext = file.type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg';
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const bytes = Buffer.from(await file.arrayBuffer());

  // L1: don't trust the client-declared Content-Type — verify the file's magic bytes
  // actually match an allowed image format, so a script/HTML can't be smuggled through.
  if (!matchesImageMagic(bytes, file.type)) {
    return c.json(
      { data: null, error: { code: 'INVALID_FILE', message: 'File contents are not a valid PNG, JPEG, or WebP image.' } },
      400,
    );
  }

  // ── Preferred path: Supabase Storage (works on serverless; durable) ─────────
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    const bucket = env.SUPABASE_STORAGE_BUCKET;
    const objectPath = `${auth.tenantId}/${filename}`;
    const base = env.SUPABASE_URL.replace(/\/$/, '');

    // Send the key in BOTH headers so either credential type works: the new
    // `sb_secret_…` secret keys and the legacy `service_role` JWT.
    const res = await fetch(`${base}/storage/v1/object/${bucket}/${objectPath}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type': file.type,
        'x-upsert': 'true',
      },
      body: bytes,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return c.json(
        {
          data: null,
          error: {
            code: 'UPLOAD_FAILED',
            message: `Storage upload failed (${res.status}). Ensure the "${bucket}" bucket exists and is public. ${detail.slice(0, 180)}`,
          },
        },
        502,
      );
    }

    // Public bucket → stable public URL.
    const url = `${base}/storage/v1/object/public/${bucket}/${objectPath}`;
    return c.json({ data: { url }, error: null });
  }

  // ── Production without storage configured: fail clearly, never a 500 crash ──
  if (env.NODE_ENV === 'production') {
    return c.json(
      {
        data: null,
        error: {
          code: 'STORAGE_NOT_CONFIGURED',
          message:
            'Image uploads are not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (public bucket) to enable device uploads.',
        },
      },
      503,
    );
  }

  // ── Local dev fallback: write to the local filesystem ───────────────────────
  const dir = join(process.cwd(), 'public', 'uploads', auth.tenantId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, filename), bytes);
  const url = `http://localhost:${env.PORT}/uploads/${auth.tenantId}/${filename}`;
  return c.json({ data: { url }, error: null });
});

/**
 * Verify a buffer's leading magic bytes match the declared image MIME type.
 * PNG: 89 50 4E 47 · JPEG: FF D8 FF · WebP: "RIFF"…"WEBP".
 */
export function matchesImageMagic(buf: Buffer, mime: string): boolean {
  if (buf.length < 12) return false;
  if (mime === 'image/png') {
    return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  }
  if (mime === 'image/jpeg') {
    return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  }
  if (mime === 'image/webp') {
    return (
      buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP'
    );
  }
  return false;
}
