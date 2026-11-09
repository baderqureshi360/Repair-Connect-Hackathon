import { clearSession, getCsrfToken, syncCsrfFromCookie } from './stores/auth';
import { online } from './stores/ui';
import { ApiError } from './api';

const API_BASE = import.meta.env.VITE_API_URL || '';

/** Fetches paginated list endpoints that return { success, data, meta } */
export async function apiList<T>(path: string): Promise<{ data: T[]; meta?: unknown }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    online.set(false);
    throw new ApiError('You are offline', 0, 'OFFLINE');
  }
  const headers = new Headers({ 'Content-Type': 'application/json' });
  syncCsrfFromCookie();
  const csrf = getCsrfToken();
  if (csrf) headers.set('X-CSRF-Token', csrf);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { headers, credentials: 'include' });
  } catch {
    online.set(false);
    throw new ApiError('Network error', 0, 'NETWORK');
  }
  online.set(true);
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) clearSession();
  if (!res.ok || body.success === false) {
    throw new ApiError(
      body?.error?.message || 'Request failed',
      res.status,
      body?.error?.code || 'ERROR',
      body?.error?.details
    );
  }
  return { data: body.data as T[], meta: body.meta };
}
