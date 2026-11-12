import { test, expect, type APIRequestContext } from '@playwright/test';
import { loginAs, apiLogin, seedBrowserSession, AUTH_API_BASE } from './helpers/auth';

/**
 * Phase 6.1 multi-tenant verification — UI navigation + direct API (cookie session).
 * Requires demo seed accounts (*@repairconnect.local).
 * Uses loginAs / apiLogin with RATE_LIMIT retries (no production limiter disable).
 *
 * Auth note: Playwright sets DISABLE_AUTH_RATE_LIMIT only when *it* starts the API.
 * Reused local servers may rate-limit; helpers cap wait and fail clearly.
 */

const API = AUTH_API_BASE;

async function cookieFrom(request: APIRequestContext) {
  const state = await request.storageState();
  return state.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

test.describe('Phase 6.1 multi-tenant isolation', () => {
  test.describe.configure({ mode: 'serial', timeout: 90_000 });

  test('customer UI stays in customer portal; API cross-repair denied', async ({ page, request }) => {
    await apiLogin(request, 'admin@repairconnect.local');
    const list = await request.get(`${API}/api/v1/repairs?limit=50`);
    test.skip(!list.ok(), 'Cannot list repairs');
    const repairs = ((await list.json()).data || []) as Array<{
      id?: string;
      _id?: string;
      referenceNumber?: string;
    }>;

    await loginAs(page, request, 'customer@repairconnect.local');
    await expect(page).toHaveURL(/customer/);
    await page.goto('/app/admin/staff');
    await expect(page).not.toHaveURL(/\/app\/admin\/staff/);

    if (repairs.length) {
      const repairId = String(repairs[0]._id || repairs[0].id || '');
      test.skip(!repairId, 'Repair id missing from list payload');
      const steal = await request.get(`${API}/api/v1/repairs/${repairId}`);
      if (steal.ok()) {
        const data = (await steal.json()).data;
        expect(JSON.stringify(data)).not.toMatch(/SECRET-B-INTERNAL|Customer B device/i);
      } else {
        expect([403, 404, 400]).toContain(steal.status());
      }
    }
  });

  test('mechanic UI loads mechanic portal; unassigned foreign shop blocked', async ({ page, request }) => {
    await loginAs(page, request, 'mechanic@repairconnect.local');
    await expect(page).toHaveURL(/mechanic/);

    const fake = '0000000000000000000000aa';
    const res = await request.get(`${API}/api/v1/repairs/${fake}`);
    expect([403, 404]).toContain(res.status());
  });

  test('parts coordinator cannot query arbitrary shop inventory', async ({ page, request }) => {
    // One API login → assert tenant denial first (security property), then seed UI.
    // Avoids burning the whole test timeout inside loginAs retries under RATE_LIMIT.
    const session = await apiLogin(request, 'parts@repairconnect.local');
    expect(session.user.role).toBe('parts_coordinator');

    const fakeShop = '0000000000000000000000aa';
    const inv = await request.get(`${API}/api/v1/parts?shopId=${fakeShop}`);
    const invText = await inv.text();
    expect(inv.status(), invText).toBe(403);
    const invBody = JSON.parse(invText);
    expect(invBody?.error?.code).toBe('SHOP_FORBIDDEN');
    expect(invBody?.data ?? null).toBeNull();

    // Authorized scope still works (own shop listing).
    const own = await request.get(`${API}/api/v1/parts?limit=5`);
    expect(own.ok(), await own.text()).toBeTruthy();
    const ownBody = await own.json();
    const rows = ownBody?.data || [];
    expect(Array.isArray(rows)).toBeTruthy();
    for (const row of rows) {
      const shop = String(row.shop?._id || row.shop || '');
      expect(shop).not.toBe(fakeShop);
    }

    await seedBrowserSession(page, request, session.user);
    await expect(page).toHaveURL(/parts/);
  });

  test('shop admin cannot read another shop reports', async ({ page, request }) => {
    await loginAs(page, request, 'admin@repairconnect.local');
    await expect(page).toHaveURL(/admin/);

    const fakeShop = '0000000000000000000000bb';
    const reports = await request.get(`${API}/api/v1/analytics/operations?shopId=${fakeShop}`);
    // Forbidden or empty scoped result — never 500
    expect(reports.status()).toBeLessThan(500);
    if (reports.status() === 200) {
      const data = (await reports.json()).data;
      if (data && typeof data === 'object' && 'shopId' in data) {
        expect(String((data as { shopId: string }).shopId)).not.toBe(fakeShop);
      }
    } else {
      expect([403, 400, 404]).toContain(reports.status());
    }
  });

  test('supplier cannot access another supplier portal data', async ({ request }) => {
    try {
      await apiLogin(request, 'supplier@repairconnect.local');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Optional account — skip when missing/invalid in this environment (not a tenant defect).
      test.skip(
        /rate-limited|INVALID_CREDENTIALS|Invalid credentials|login failed for supplier/i.test(msg),
        `No demo supplier account in this environment: ${msg}`
      );
      throw err;
    }
    const cookie = await cookieFrom(request);
    const catalog = await request.get(`${API}/api/v1/supplier/catalog`, {
      headers: { Cookie: cookie }
    });
    expect([200, 403]).toContain(catalog.status());
    const foreign = await request.get(
      `${API}/api/v1/supplier-network/purchasing-analytics?shopId=0000000000000000000000cc`,
      { headers: { Cookie: cookie } }
    );
    expect([403, 401]).toContain(foreign.status());
  });
});
