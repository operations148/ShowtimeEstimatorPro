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

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

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
      { data: null, error: { code: 'INVALID_FILE', message: 'Only JPEG, PNG, WebP, GIF, and AVIF are allowed' } },
      400,
    );
  }

  if (file.size > MAX_BYTES) {
    return c.json(
      { data: null, error: { code: 'FILE_TOO_LARGE', message: 'File must be under 5 MB' } },
      400,
    );
  }

  const ext = file.type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg';
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const bytes = Buffer.from(await file.arrayBuffer());

  // ── Preferred path: Supabase Storage (works on serverless; durable) ─────────
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    const bucket = env.SUPABASE_STORAGE_BUCKET;
    const objectPath = `${auth.tenantId}/${filename}`;
    const base = env.SUPABASE_URL.replace(/\/$/, '');

    const res = await fetch(`${base}/storage/v1/object/${bucket}/${objectPath}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
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
