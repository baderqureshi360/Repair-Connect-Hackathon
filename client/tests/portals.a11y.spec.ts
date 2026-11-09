import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel(/email|ای میل/i).fill(email);
  await page.getByLabel(/password|پاس ورڈ/i).fill('Password123!');
  await page.getByRole('button', { name: /sign in|سائن ان/i }).click();
  await page.waitForURL(/\/app\//, { timeout: 20000 });
}

async function expectNoSeriousAxe(page: Page, label: string) {
  await page.waitForLoadState('domcontentloaded');
  let results;
  try {
    results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
  } catch {
    await page.waitForLoadState('domcontentloaded');
    results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
  }
  const serious = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
  expect(serious, `${label}: ${JSON.stringify(serious, null, 2)}`).toEqual([]);
}

async function switchUrdu(page: Page) {
  await page.locator('#lang-select').selectOption('ur');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
}

test.describe('Portal accessibility and RTL', () => {
  test('customer portal axe + keyboard + RTL', async ({ page }) => {
    await login(page, 'customer@repairconnect.local');
    await expect(page).toHaveURL(/customer/);
    await expectNoSeriousAxe(page, 'customer-dashboard');

    await page.keyboard.press('Tab');
    const tag = await page.evaluate(() => document.activeElement?.tagName);
    expect(['A', 'BUTTON', 'SELECT', 'INPUT', 'BODY', 'SUMMARY']).toContain(tag);

    await page.goto('/app/customer/repairs');
    await expect(page).toHaveURL(/\/app\/customer\/repairs/);
    await expect(page.locator('main')).toBeVisible({ timeout: 15000 });
    await expectNoSeriousAxe(page, 'customer-repairs');

    await switchUrdu(page);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('navigation', { name: /main/i })).toBeVisible({ timeout: 10000 });
    const align = await page.locator('main').evaluate((el) => getComputedStyle(el).direction);
    expect(align).toBe('rtl');

    await page.setViewportSize({ width: 360, height: 800 });
    await expect(page.getByRole('button', { name: /open navigation|نیویگیشن کھولیں/i })).toBeVisible();
    await expect(page.locator('header summary[aria-label]')).toBeVisible();
    await expect(page.locator('main')).toBeVisible({ timeout: 5000 });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: /open navigation|نیویگیشن کھولیں/i })).toBeVisible();
    await expect(page.locator('header summary[aria-label]')).toBeVisible();
    await expect(page.locator('main')).toBeVisible({ timeout: 5000 });
    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(page.locator('main')).toBeVisible({ timeout: 5000 });
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.locator('main')).toBeVisible({ timeout: 5000 });
  });

  test('mechanic portal axe + RTL', async ({ page }) => {
    await login(page, 'mechanic@repairconnect.local');
    await expect(page).toHaveURL(/mechanic/);
    await expectNoSeriousAxe(page, 'mechanic-dashboard');
    await switchUrdu(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ur');
  });

  test('parts portal axe + tables', async ({ page }) => {
    await login(page, 'parts@repairconnect.local');
    await expect(page).toHaveURL(/parts/);
    await expectNoSeriousAxe(page, 'parts-dashboard');
    await page.goto('/app/parts/inventory');
    await expect(page.getByRole('table')).toBeVisible();
    await expectNoSeriousAxe(page, 'parts-inventory');
    await switchUrdu(page);
  });

  test('admin portal axe + staff', async ({ page }) => {
    await login(page, 'admin@repairconnect.local');
    await expect(page).toHaveURL(/admin/);
    await expectNoSeriousAxe(page, 'admin-dashboard');
    await page.goto('/app/admin/staff');
    await expect(page.getByRole('heading')).toBeVisible();
    await expectNoSeriousAxe(page, 'admin-staff');
    await switchUrdu(page);
  });
});
