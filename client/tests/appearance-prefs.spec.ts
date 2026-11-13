import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';

test.describe('Appearance preferences — indigo defaults', () => {
  test('keeps saved accent; restore defaults selects Indigo locally', async ({
    page,
    request
  }) => {
    await loginAs(page, request, 'admin@repairconnect.local');
    await page.goto('/app/appearance');
    await expect(page.getByRole('heading', { name: /appearance/i })).toBeVisible();

    // Explicit non-default accent — must stick until restore/save
    await page.getByRole('radio', { name: 'Teal' }).check();
    await page.getByRole('button', { name: /save preferences/i }).click();
    await expect(page.getByText(/preferences saved/i)).toBeVisible({ timeout: 10000 });
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'teal');

    await page.reload();
    await expect(page.getByRole('radio', { name: 'Teal' })).toBeChecked();
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'teal');

    await page.getByRole('button', { name: /restore defaults/i }).click();
    await expect(page.getByRole('radio', { name: 'Indigo' })).toBeChecked();
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'indigo');

    const primary = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim()
    );
    expect(primary.toLowerCase()).toBe('#3730a3');

    // Persist indigo so later suites see the product default for this account
    await page.getByRole('button', { name: /save preferences/i }).click();
    await expect(page.getByText(/preferences saved/i)).toBeVisible({ timeout: 10000 });
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'indigo');
  });
});
