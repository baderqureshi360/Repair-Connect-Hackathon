import { test, expect } from '@playwright/test';
import path from 'node:path';
import { loginAs } from './helpers/auth';

const OUT = path.resolve(process.cwd(), '../docs/screenshots');
const widths = [360, 390, 768, 1440] as const;

test.describe('Porto mechanic portal screenshots', () => {
  test('capture light and dark viewports', async ({ page, request }) => {
    await loginAs(page, request, 'mechanic@repairconnect.local');
    await expect(page).toHaveURL(/mechanic/);
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
        path: path.join(OUT, `porto-mechanic-${width}.png`),
        fullPage: true
      });
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await applyPortoDocTheme('dark');
    await expect(page.locator('main')).toBeVisible();
    await page.screenshot({
      path: path.join(OUT, 'porto-mechanic-1440-dark.png'),
      fullPage: true
    });

    await page.goto('/app/mechanic/jobs');
    await expect(page.locator('main')).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(800);
    await page.emulateMedia({ colorScheme: 'light' });
    await applyPortoDocTheme('light');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({
      path: path.join(OUT, 'porto-mechanic-jobs-1440.png'),
      fullPage: true
    });
  });
});
