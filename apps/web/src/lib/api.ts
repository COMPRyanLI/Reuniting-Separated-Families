/**
 * Same-origin JSON client. The CSRF token lives only in memory (never localStorage);
 * the session itself is an HttpOnly cookie the script cannot read.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fieldErrors: { path: string; message: string }[] = [],
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  /** True when the request may not have reached the server (offline, timeout, 5xx). */
  get notSubmitted(): boolean {
    return this.code === 'NETWORK' || this.code === 'TIMEOUT' || this.status >= 500;
  }
}

let csrfToken: string | null = null;
let lastUserActivity = Date.now();
/** Time of the last request that counted as user activity on the server (non-background). */
export function lastServerActivity(): number {
  return lastUserActivity;
}
let onUnauthenticated: (() => void) | null = null;

export function setCsrfToken(token: string | null) {
  csrfToken = token;
}
export function setUnauthenticatedHandler(handler: (() => void) | null) {
  onUnauthenticated = handler;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

interface Options {
  idempotencyKey?: string;
  background?: boolean;
  /** Public endpoints (login, register) report 401 to the form rather than ending a session. */
  public?: boolean;
  timeoutMs?: number;
}

export async function api<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown, opts: Options = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  if (opts.background) headers['X-Background-Refresh'] = '1';
  else lastUserActivity = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch (e) {
    const timedOut = e instanceof DOMException && e.name === 'AbortError';
    throw new ApiError(
      0,
      timedOut ? 'TIMEOUT' : 'NETWORK',
      timedOut
        ? 'Not submitted: the server took too long to answer. Check your connection and try again.'
        : 'Not submitted: no connection to the server. Check your connection and try again.',
    );
  } finally {
    clearTimeout(timer);
  }
  // An empty success still resolves to a value, so callers can tell success from failure.
  if (res.status === 204) return {} as T;
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string; fieldErrors?: { path: string; message: string }[] } } | null)?.error;
    const apiError = new ApiError(
      res.status,
      err?.code ?? 'HTTP_ERROR',
      res.status >= 500
        ? 'Not saved: something went wrong on the server. Try again in a moment.'
        : (err?.message ?? 'Something went wrong.'),
      err?.fieldErrors ?? [],
      Number(res.headers.get('Retry-After')) || undefined,
    );
    if (res.status === 401 && !opts.public) onUnauthenticated?.();
    throw apiError;
  }
  return json as T;
}
