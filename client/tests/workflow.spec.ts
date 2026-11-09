import { test, expect } from '@playwright/test';

test.describe('UI smoke', () => {
  test('customer can sign in and open portal', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email|ای میل/i).fill('customer@repairconnect.local');
    await page.getByLabel(/password|پاس ورڈ/i).fill('Password123!');
    await page.getByRole('button', { name: /sign in|سائن ان/i }).click();
    await expect(page).toHaveURL(/customer/);
    await expect(page.getByRole('heading').first()).toBeVisible();
  });

  test('language switch updates document direction for Urdu', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email|ای میل/i).fill('customer@repairconnect.local');
    await page.getByLabel(/password|پاس ورڈ/i).fill('Password123!');
    await page.getByRole('button', { name: /sign in|سائن ان/i }).click();
    await expect(page).toHaveURL(/customer/);
    await page.locator('#lang-select').selectOption('ur');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });
});
