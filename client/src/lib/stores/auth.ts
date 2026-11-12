import { writable, derived, get } from 'svelte/store';
import { browser } from '$app/environment';

export type Role =
  | 'customer'
  | 'mechanic'
  | 'parts_coordinator'
  | 'shop_admin'
  | 'supplier'
  | 'platform_operator';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  preferredLanguage?: 'en' | 'ur';
  shops?: unknown[];
  accountStatus?: 'active' | 'pending_shop_owner' | 'pending_supplier';
  onboardingPending?: boolean;
}

const CSRF_COOKIE = 'rc_csrf';
const USER_KEY = 'rc_user';

function loadUser(): AuthUser | null {
  if (!browser) return null;
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

function readCsrfCookie(): string | null {
  if (!browser) return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/** Session flag only — JWTs live in HttpOnly cookies, never in JS. */
export const sessionActive = writable<boolean>(browser ? Boolean(loadUser()) : false);
export const user = writable<AuthUser | null>(loadUser());
export const csrfToken = writable<string | null>(browser ? readCsrfCookie() : null);

export const isAuthenticated = derived(sessionActive, ($s) => $s);

/** @deprecated Prefer sessionActive; kept so older imports compile during migration. */
export const token = sessionActive;

export function getCsrfToken(): string | null {
  return get(csrfToken) || readCsrfCookie();
}

export function setSession(nextUser: AuthUser, nextCsrf?: string) {
  sessionActive.set(true);
  user.set(nextUser);
  if (nextCsrf) {
    csrfToken.set(nextCsrf);
  } else {
    // Cross-origin API cookies are not visible to document.cookie on the SPA origin.
    // Prefer an explicit token from the JSON body; only fall back to a readable cookie.
    const fromCookie = readCsrfCookie();
    if (fromCookie) csrfToken.set(fromCookie);
  }
  if (browser) {
    localStorage.setItem(USER_KEY, JSON.stringify(nextUser));
    localStorage.removeItem('rc_token');
  }
}

export function clearSession() {
  sessionActive.set(false);
  user.set(null);
  csrfToken.set(null);
  if (browser) {
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem('rc_token');
  }
}

export function syncCsrfFromCookie() {
  const fromCookie = readCsrfCookie();
  // Never wipe an in-memory CSRF from login/refresh when the cookie is on another site.
  if (fromCookie) csrfToken.set(fromCookie);
}
