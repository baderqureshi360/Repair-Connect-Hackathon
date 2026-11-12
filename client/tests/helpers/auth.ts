import { expect, type APIRequestContext, type Page } from '@playwright/test';

const API = process.env.PLAYWRIGHT_API_URL || 'http://localhost:5000';
const PASSWORD = 'Password123!';

const ROLE_HOME: Record<string, string> = {
  customer: '/app/customer',
  mechanic: '/app/mechanic',
  parts_coordinator: '/app/parts',
  shop_admin: '/app/admin',
  supplier: '/app/supplier',
  platform_operator: '/app/platform'
};

export type LoginResult = {
  csrf: string;
  user: { id: string; email: string; name: string; role: string };
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Controlled auth for Playwright: API session + cookie seed.
 * Retries on RATE_LIMIT without disabling production auth security.
 * Caps total wait so suites fail with a clear RATE_LIMIT error instead of a generic test timeout.
 */
export async function apiLogin(
  request: APIRequestContext,
  email: string,
  password = PASSWORD,
  attempts = 8,
  maxTotalWaitMs = 180_000
): Promise<LoginResult> {
  let lastText = '';
  let waited = 0;
  for (let i = 0; i < attempts; i++) {
    const existingCsrf = (await request.storageState()).cookies.find((c) => c.name === 'rc_csrf')
      ?.value;
    const res = await request.post(`${API}/api/v1/auth/login`, {
      headers: existingCsrf ? { 'X-CSRF-Token': existingCsrf } : undefined,
      data: { email, password }
    });
    lastText = await res.text();
    if (res.ok()) {
      const body = JSON.parse(lastText);
      const csrf =
        body.data?.csrfToken ||
        (await request.storageState()).cookies.find((c) => c.name === 'rc_csrf')?.value;
      expect(csrf, 'csrf after login').toBeTruthy();
      expect(body.data?.user, 'user after login').toBeTruthy();
      return { csrf: String(csrf), user: body.data.user };
    }
    const isRateLimited =
      res.status() === 429 || /RATE_LIMIT|Too many attempts/i.test(lastText);
    if (!isRateLimited) {
      expect(res.ok(), `login failed for ${email}: ${res.status()} ${lastText}`).toBeTruthy();
    }
    if (i === attempts - 1 || waited >= maxTotalWaitMs) {
      throw new Error(
        `login rate-limited for ${email} after ${i + 1} attempts (${waited}ms waited): ${lastText}`
      );
    }
    const retryAfter = Number(res.headers()['retry-after'] || 0);
    const delay = retryAfter > 0 ? retryAfter * 1000 : Math.min(8000, 1500 * 2 ** i);
    const slice = Math.min(delay, Math.max(0, maxTotalWaitMs - waited));
    waited += slice;
    await sleep(slice);
  }
  throw new Error(`login exhausted retries for ${email}: ${lastText}`);
}

/** Seed browser cookies + localStorage from an existing API session (no extra login). */
export async function seedBrowserSession(
  page: Page,
  request: APIRequestContext,
  user: LoginResult['user']
) {
  const state = await request.storageState();
  await page.context().clearCookies();
  await page.context().addCookies(
    state.cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: 'localhost',
      path: c.path || '/',
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: (c.sameSite as 'Lax' | 'Strict' | 'None') || 'Lax'
    }))
  );
  await page.goto('/login');
  await page.evaluate((u) => {
    localStorage.setItem('rc_user', JSON.stringify(u));
    localStorage.removeItem('rc_token');
  }, user);
  const home = ROLE_HOME[user.role] || '/app/customer';
  await page.goto(home);
  await page.waitForURL(/\/app\//, { timeout: 30000 });
}

/** Seed browser cookies + localStorage from an API session, then open role home. */
export async function loginAs(
  page: Page,
  request: APIRequestContext,
  email: string
): Promise<LoginResult> {
  const session = await apiLogin(request, email);
  await seedBrowserSession(page, request, session.user);
  return session;
}

export { API as AUTH_API_BASE, ROLE_HOME };
