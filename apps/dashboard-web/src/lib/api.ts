const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

interface ApiResponse<T> {
  data: T | null;
  error: { code: string; message: string } | null;
  meta?: Record<string, unknown>;
}

let csrfToken: string | null = null;

export async function getCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  const res = await fetch(`${API_URL}/auth/csrf-token`, { credentials: 'include' });
  const json = (await res.json()) as ApiResponse<{ csrfToken: string }>;
  csrfToken = json.data?.csrfToken ?? '';
  return csrfToken;
}

async function request<T>(
  path: string,
  opts: RequestInit = {},
): Promise<ApiResponse<T>> {
  const method = (opts.method ?? 'GET').toUpperCase();
  const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

  const extraHeaders: Record<string, string> = {};
  if (mutating) {
    extraHeaders['X-CSRF-Token'] = await getCsrfToken();
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...opts,
      credentials: 'include',
      headers: {
        // Don't send Content-Type on GET/HEAD — it triggers an OPTIONS preflight that
        // some routes handle with widget CORS (not dashboard CORS), blocking the request.
        ...(mutating ? { 'Content-Type': 'application/json' } : {}),
        ...extraHeaders,
        ...opts.headers,
      },
    });
  } catch {
    return { data: null, error: { code: 'NETWORK_ERROR', message: 'Cannot reach API server' } };
  }

  // If CSRF token expired, clear cache and retry once
  if (res.status === 403) {
    csrfToken = null;
    const retryHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-CSRF-Token': await getCsrfToken(),
      ...(opts.headers as Record<string, string>),
    };
    try {
      res = await fetch(`${API_URL}${path}`, { ...opts, credentials: 'include', headers: retryHeaders });
    } catch {
      return { data: null, error: { code: 'NETWORK_ERROR', message: 'Cannot reach API server' } };
    }
  }

  try {
    return (await res.json()) as ApiResponse<T>;
  } catch {
    return { data: null, error: { code: 'PARSE_ERROR', message: 'Invalid response from server' } };
  }
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
