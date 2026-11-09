import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Accessibility', () => {
  test('login page has no critical axe violations', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /sign in|سائن ان/i })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const critical = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(critical, JSON.stringify(critical, null, 2)).toEqual([]);
  });

  test('supports keyboard focus on login controls', async ({ page }) => {
    await page.goto('/login');
    await page.keyboard.press('Tab');
    // Skip link or first focusable
    const focused = await page.evaluate(() => document.activeElement?.tagName);
    expect(['A', 'INPUT', 'BUTTON', 'SELECT']).toContain(focused);
  });
});
