import { clearSession, csrfToken, getCsrfToken, syncCsrfFromCookie } from './stores/auth';
import { announce, online } from './stores/ui';

const API_BASE = import.meta.env.VITE_API_URL || '';

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(message: string, status: number, code: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type ApiErrorBody = {
  success?: boolean;
  error?: { message?: string; code?: string; details?: unknown };
  data?: { csrfToken?: string } & Record<string, unknown>;
};

/** Prefer API error message; surface proxy/unreachable cases instead of generic "Request failed". */
export function messageFromFailedResponse(res: Response, body: ApiErrorBody): string {
  const apiMsg = body?.error?.message;
  if (typeof apiMsg === 'string' && apiMsg.trim()) return apiMsg;

  if (res.status === 502 || res.status === 503 || res.status === 504) {
    return 'API server unreachable. Start the backend (npm run dev:server) on port 5000.';
  }
  if (res.status >= 500) {
    return 'Server error. If this persists, confirm the API is running and reachable.';
  }
  if (res.status === 429) return 'Too many attempts. Please wait and try again.';
  if (res.statusText) return `Request failed (${res.status} ${res.statusText})`;
  return `Request failed (${res.status || 'network'})`;
}

export function statusToErrorCode(status: number): string {
  if (status === 502 || status === 503 || status === 504) return 'API_UNREACHABLE';
  if (status >= 500) return 'SERVER_ERROR';
  if (status === 429) return 'RATE_LIMIT';
  return 'ERROR';
}

async function readApiBody(res: Response): Promise<ApiErrorBody> {
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    // Drain non-JSON (Vite proxy HTML/text) so the connection can close cleanly.
    await res.text().catch(() => '');
    return {};
  }
  return (await res.json().catch(() => ({}))) as ApiErrorBody;
}

type ApiOptions = RequestInit & { idempotencyKey?: string; full?: boolean; skipRefresh?: boolean };

/** Coalesce concurrent 401→refresh attempts into one network round-trip. */
let refreshInFlight: Promise<boolean> | null = null;

async function tryRefreshOnce(): Promise<boolean> {
  try {
    syncCsrfFromCookie();
    let csrf = getCsrfToken();
    // When API is cross-origin, rc_csrf is not readable via document.cookie — mint via API.
    // Same-origin proxy makes the cookie first-party again; bootstrap still helps cold loads.
    if (!csrf) {
      const bootstrap = await fetch(`${API_BASE}/api/v1/auth/csrf`, {
        method: 'GET',
        credentials: 'include'
      });
      if (bootstrap.ok) {
        const body = await bootstrap.json().catch(() => ({}));
        if (body?.data?.csrfToken) {
          csrfToken.set(body.data.csrfToken);
          csrf = body.data.csrfToken;
        }
      }
    }
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (csrf) headers.set('X-CSRF-Token', csrf);
    const res = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers
    });
    if (!res.ok) return false;
    const body = await res.json().catch(() => ({}));
    if (body?.data?.csrfToken) {
      csrfToken.set(body.data.csrfToken);
    } else {
      syncCsrfFromCookie();
    }
    return true;
  } catch {
    return false;
  }
}

async function tryRefresh(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = tryRefreshOnce().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    online.set(false);
    throw new ApiError('You are offline', 0, 'OFFLINE');
  }

  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey);

  const method = (options.method || 'GET').toUpperCase();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    syncCsrfFromCookie();
    const csrf = getCsrfToken();
    if (csrf) headers.set('X-CSRF-Token', csrf);
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      credentials: 'include'
    });
  } catch {
    online.set(false);
    announce.set('Connection lost');
    throw new ApiError('Network error', 0, 'NETWORK');
  }

  online.set(true);

  if (res.status === 401 && !options.skipRefresh && !path.includes('/auth/login') && !path.includes('/auth/refresh')) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      return api<T>(path, { ...options, skipRefresh: true });
    }
    clearSession();
  }

  const body = await readApiBody(res);

  if (res.status === 401) {
    clearSession();
  }

  if (!res.ok || body.success === false) {
    throw new ApiError(
      messageFromFailedResponse(res, body),
      res.status,
      body?.error?.code || statusToErrorCode(res.status),
      body?.error?.details
    );
  }

  if (body?.data?.csrfToken) {
    csrfToken.set(body.data.csrfToken);
  }

  if (options.full) return body as T;
  return body.data as T;
}

export function saveDraft(key: string, data: unknown) {
  localStorage.setItem(`rc_draft_${key}`, JSON.stringify({ data, savedAt: Date.now() }));
}

export function loadDraft<T>(key: string): T | null {
  const raw = localStorage.getItem(`rc_draft_${key}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw).data as T;
  } catch {
    return null;
  }
}

export function clearDraft(key: string) {
  localStorage.removeItem(`rc_draft_${key}`);
}
