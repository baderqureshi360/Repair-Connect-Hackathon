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

type ApiOptions = RequestInit & { idempotencyKey?: string; full?: boolean; skipRefresh?: boolean };

async function tryRefresh(): Promise<boolean> {
  try {
    const csrf = getCsrfToken();
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

  const body = await res.json().catch(() => ({}));

  if (res.status === 401) {
    clearSession();
  }

  if (!res.ok || body.success === false) {
    throw new ApiError(
      body?.error?.message || 'Request failed',
      res.status,
      body?.error?.code || 'ERROR',
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
