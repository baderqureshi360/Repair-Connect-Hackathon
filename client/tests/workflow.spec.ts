import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';

test.describe('UI smoke', () => {
  test('customer can sign in and open portal', async ({ page, request }) => {
    await loginAs(page, request, 'customer@repairconnect.local');
    await expect(page).toHaveURL(/customer/);
    await expect(page.getByRole('heading').first()).toBeVisible();
  });

  test('language switch updates document direction for Urdu', async ({ page, request }) => {
    await loginAs(page, request, 'customer@repairconnect.local');
    await expect(page).toHaveURL(/customer/);
    await page.locator('#lang-select').selectOption('ur');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });
});
