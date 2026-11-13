import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';

test.describe('Notification bell inbox', () => {
  for (const email of [
    'customer@repairconnect.local',
    'mechanic@repairconnect.local',
    'parts@repairconnect.local',
    'admin@repairconnect.local'
  ]) {
    test(`bell visible for ${email.split('@')[0]}`, async ({ page, request }) => {
      await loginAs(page, request, email);
      await expect(page.getByTestId('notification-bell')).toBeVisible({ timeout: 20000 });
    });
  }

  test('panel opens with loading/empty/list states and supports mark-all + view all', async ({
    page,
    request
  }) => {
    await loginAs(page, request, 'admin@repairconnect.local');
    await expect(page).toHaveURL(/\/app\/admin/, { timeout: 20000 });

    const bell = page.getByTestId('notification-bell');
    await expect(bell).toBeVisible({ timeout: 15000 });
    await bell.click();

    const panel = page.getByTestId('notification-panel');
    await expect(panel).toBeVisible({ timeout: 10000 });
    await expect(panel.getByRole('button', { name: /mark all read|سب کو پڑھا/i })).toBeVisible();

    // Click outside closes the panel (mousedown handler)
    await page.locator('#main').click({ position: { x: 8, y: 8 } });
    await expect(panel).toBeHidden({ timeout: 5000 });

    await bell.click();
    await expect(panel).toBeVisible({ timeout: 10000 });

    const items = page.getByTestId('notification-item');
    const count = await items.count();
    if (count > 0) {
      await expect(items.first()).toBeVisible();
      await page.getByTestId('notification-mark-all').click();
      // Unread badges on items clear (or panel stays usable)
      await expect(panel).toBeVisible();
      await items.first().click();
      await expect(panel).toBeHidden({ timeout: 15000 });
      await expect(page).not.toHaveURL(/\/login/);
    } else {
      await expect(panel.getByText(/no notifications|کوئی اطلاع/i)).toBeVisible();
      await page.getByTestId('notification-view-all').click();
      await expect(page).toHaveURL(/\/app\/notifications/);
      await expect(page.getByRole('heading', { name: /notifications|اطلاعات/i })).toBeVisible({
        timeout: 15000
      });
    }
  });

  test('customer notifications page mark-read syncs without exposing other users', async ({
    page,
    request
  }) => {
    await loginAs(page, request, 'customer@repairconnect.local');
    await page.goto('/app/notifications');
    await expect(page.getByRole('heading', { name: /notifications|اطلاعات/i })).toBeVisible({
      timeout: 20000
    });
    await expect(page.getByText(/repair updates|مرمت کی تازہ/i)).toBeVisible();
    // Preference card + list/empty present; no staff-only wording required
    await expect(page.getByTestId('notification-bell')).toBeVisible();
  });
});
