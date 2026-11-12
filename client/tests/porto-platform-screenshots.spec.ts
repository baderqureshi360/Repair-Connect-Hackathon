import { test, expect } from '@playwright/test';
import path from 'node:path';
import { loginAs } from './helpers/auth';

const OUT = path.resolve(process.cwd(), '../docs/screenshots');
const widths = [360, 390, 768, 1440] as const;

test.describe('Porto platform operator screenshots', () => {
  test('capture light and dark viewports', async ({ page, request }) => {
    test.setTimeout(120_000);
    try {
      await loginAs(page, request, 'p4.e2e.ops@repairconnect.local');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      test.skip(
        /rate-limited|INVALID_CREDENTIALS|Invalid credentials|login failed/i.test(msg),
        `No platform operator account in this environment: ${msg}`
      );
      throw err;
    }
    await expect(page).toHaveURL(/\/app\/platform/);
    await expect(page.locator('main')).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1500);

    async function applyPortoDocTheme(mode: 'light' | 'dark') {
      await page.evaluate((theme) => {
        const root = document.documentElement;
        root.classList.toggle('dark', theme === 'dark');
        root.dataset.accent = 'emerald';
        root.style.setProperty('--color-accent', '#82b440');
        root.style.setProperty('--color-accent-hover', '#6f9a36');
        root.style.setProperty('--color-accent-soft', '#eef6e3');
        root.style.setProperty('--color-accent-foreground', '#1a2e05');
        root.style.setProperty('--color-focus', '#5a8a28');
        root.style.setProperty('--color-primary', '#82b440');
        root.style.setProperty('--color-primary-hover', '#6f9a36');
      }, mode);
      await page.waitForTimeout(200);
    }

    for (const width of widths) {
      await page.setViewportSize({ width, height: width >= 768 ? 900 : 800 });
      await page.emulateMedia({ colorScheme: 'light' });
      await applyPortoDocTheme('light');
      await expect(page.locator('main')).toBeVisible();
      await page.screenshot({
        path: path.join(OUT, `porto-platform-${width}.png`),
        fullPage: true
      });
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await applyPortoDocTheme('dark');
    await expect(page.locator('main')).toBeVisible();
    await page.screenshot({
      path: path.join(OUT, 'porto-platform-1440-dark.png'),
      fullPage: true
    });

    await page.goto('/app/platform/shop-applications');
    await expect(page.locator('main')).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(800);
    await page.emulateMedia({ colorScheme: 'light' });
    await applyPortoDocTheme('light');
    await page.screenshot({
      path: path.join(OUT, 'porto-platform-shop-apps-1440.png'),
      fullPage: true
    });

    await page.goto('/app/platform/supplier-reviews');
    await expect(page.locator('main')).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(600);
    await page.screenshot({
      path: path.join(OUT, 'porto-platform-reviews-1440.png'),
      fullPage: true
    });
  });
});
