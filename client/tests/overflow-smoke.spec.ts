import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';

const widths = [360, 390, 768, 1024, 1280, 1440];

const routes: { email: string; path: string }[] = [
  { email: 'customer@repairconnect.local', path: '/app/customer' },
  { email: 'mechanic@repairconnect.local', path: '/app/mechanic' },
  { email: 'parts@repairconnect.local', path: '/app/parts' },
  { email: 'admin@repairconnect.local', path: '/app/admin' },
  { email: 'customer@repairconnect.local', path: '/login' },
  { email: 'customer@repairconnect.local', path: '/' }
];

test.describe('Responsive overflow smoke', () => {
  for (const route of routes) {
    test(`${route.path} has no document horizontal overflow`, async ({ page, request }) => {
      if (route.path.startsWith('/app')) {
        await loginAs(page, request, route.email);
      }
      await page.goto(route.path);
      await expect(page.locator('body')).toBeVisible();

      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        const overflow = await page.evaluate((w) => {
          const doc = document.documentElement;
          const body = document.body;
          return {
            width: w,
            scrollWidth: Math.max(doc.scrollWidth, body.scrollWidth),
            clientWidth: doc.clientWidth,
            delta: Math.max(doc.scrollWidth, body.scrollWidth) - doc.clientWidth
          };
        }, width);
        expect(overflow.delta, `horizontal overflow at ${width}px on ${route.path}`).toBeLessThanOrEqual(1);
      }
    });
  }
});
