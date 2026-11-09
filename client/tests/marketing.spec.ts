import { test, expect } from '@playwright/test';

test.describe('Public marketing website', () => {
  test('unauthenticated visitors see landing, not private dashboard', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Your Repairs\. Your Shop/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Customer Sign In/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /Repair Shop Sign In/i }).first()).toBeVisible();
    await expect(page.getByRole('navigation', { name: /Marketing/i })).toBeVisible();
    await expect(page.locator('a[href="/app/admin"]')).toHaveCount(0);
  });

  test('public entry routes load', async ({ page }) => {
    for (const path of [
      '/privacy',
      '/terms',
      '/accessibility',
      '/forgot-password',
      '/login?portal=customer',
      '/login?portal=shop',
      '/register',
      '/shop-registration',
      '/track'
    ]) {
      const res = await page.goto(path);
      expect(res?.ok()).toBeTruthy();
    }
  });

  test('track page accepts form fields accessibly', async ({ page }) => {
    await page.goto('/track');
    await expect(page.getByLabel(/Repair reference number/i)).toBeVisible();
    await expect(page.getByLabel(/Private tracking access code/i)).toBeVisible();
    await page.getByRole('button', { name: /Track Repair/i }).click();
    // HTML5 required validation or API denial — page should remain usable
    await expect(page.getByRole('heading', { name: /Track your repair/i })).toBeVisible();
  });

  test('shop registration form submits application', async ({ page }) => {
    await page.goto('/shop-registration');
    await page.getByLabel(/Shop name/i).fill('Playwright Valley Repairs');
    await page.getByLabel(/Business email/i).fill(`apply-${Date.now()}@example.com`);
    await page.getByLabel(/Contact person/i).fill('Test Contact');
    await page.getByLabel(/^Phone$/i).fill('03001234567');
    await page.getByLabel(/^Address$/i).fill('12 Test Road');
    await page.getByLabel(/^City$/i).fill('Lahore');
    await page.getByLabel(/^Region$/i).fill('Punjab');
    await page.getByLabel(/Description of repair services/i).fill('Phones and laptops hardware repair services.');
    await page.getByRole('button', { name: /Submit/i }).click();
    await expect(page.getByText(/Application submitted/i)).toBeVisible({ timeout: 15_000 });
  });
});
