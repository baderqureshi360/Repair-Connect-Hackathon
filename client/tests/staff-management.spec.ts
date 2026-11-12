import { test, expect } from '@playwright/test';
import { apiLogin, loginAs } from './helpers/auth';

const API = process.env.PLAYWRIGHT_API_URL || 'http://localhost:5000';
const PASSWORD = 'Password123!';

test.describe('Staff Management', () => {
  test('shop admin can open Staff Management and add a parts coordinator', async ({
    page,
    request
  }) => {
    const admin = await apiLogin(request, 'admin@repairconnect.local');
    const me = await request.get(`${API}/api/v1/auth/me`);
    expect(me.ok(), await me.text()).toBeTruthy();
    const meBody = await me.json();
    const shops = meBody.data?.shops || meBody.data?.user?.shops || [];
    // /auth/me shops[] are memberships; prefer nested shop id over membership _id
    let shopId = String(
      shops[0]?.shop?._id || shops[0]?.shop?.id || shops[0]?.shopId || shops[0]?.shop || ''
    );
    if (!shopId) {
      const mine = await request.get(`${API}/api/v1/shops/mine`);
      expect(mine.ok(), await mine.text()).toBeTruthy();
      const list = (await mine.json()).data || [];
      shopId = String(list[0]?._id || list[0]?.id || '');
    }
    expect(shopId).toBeTruthy();

    const stamp = Date.now();
    const email = `pc.e2e.${stamp}@repairconnect.test`;
    const create = await request.post(`${API}/api/v1/auth/staff`, {
      headers: { 'X-CSRF-Token': admin.csrf },
      data: {
        email,
        password: PASSWORD,
        name: `PC E2E ${stamp}`,
        role: 'parts_coordinator',
        shopId,
        phone: '03001112233',
        invite: true
      }
    });
    expect(create.ok(), await create.text()).toBeTruthy();
    const created = await create.json();
    expect(created.data.user.role).toBe('parts_coordinator');

    await loginAs(page, request, 'admin@repairconnect.local');
    await page.goto('/app/admin/staff');
    await expect(page.getByTestId('staff-management')).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('heading', { name: /staff management|عملہ/i })).toBeVisible();

    await page.getByTestId('staff-search').fill(email);
    await expect(page.getByTestId('staff-row').filter({ hasText: email })).toBeVisible({
      timeout: 10000
    });

    await loginAs(page, request, email);
    await expect(page).toHaveURL(/\/app\/parts/);
  });

  test('customer is redirected away from staff management', async ({ page, request }) => {
    await loginAs(page, request, 'customer@repairconnect.local');
    await expect(page).toHaveURL(/\/app\/customer/);
    await page.goto('/app/admin/staff');
    await expect(page).toHaveURL(/\/app\/customer/, { timeout: 15000 });
    await expect(page.getByTestId('staff-management')).toHaveCount(0);
  });
});
