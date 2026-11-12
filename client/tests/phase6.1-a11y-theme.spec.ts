import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { loginAs } from './helpers/auth';

test.describe('Phase 6.1 a11y theme / motion / viewports', () => {
  test('dark/light preference + reduced motion + viewport sweep', async ({ page, request }) => {
    await loginAs(page, request, 'customer@repairconnect.local');
    await expect(page).toHaveURL(/customer/);

    // Theme: prefer dark via matchMedia emulation then light
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.reload();
    await expect(page.locator('main')).toBeVisible({ timeout: 15000 });

    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await page.reload();
    await expect(page.locator('main')).toBeVisible({ timeout: 15000 });

    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);

    for (const width of [360, 390, 768, 1024, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator('main')).toBeVisible({ timeout: 8000 });
      // Landmark: desktop nav or mobile header control
      const nav = page.getByRole('navigation');
      const mobileToggle = page.getByRole('button', { name: /open navigation|نیویگیشن کھولیں/i });
      const header = page.locator('header');
      await expect(nav.or(mobileToggle).or(header).first()).toBeVisible({ timeout: 8000 });
    }

    // RTL Urdu
    const lang = page.locator('#lang-select');
    if (await lang.count()) {
      await lang.selectOption('ur');
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    }
  });
});
