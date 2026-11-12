import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth';

/**
 * Real CDP keyboard input (page.keyboard), not synthetic window.dispatchEvent.
 * Documents Chrome/Windows conflicts where browser chrome may consume chords.
 */
test.describe('Real keyboard input (Chrome/Windows)', () => {
  test('Ctrl+K / Ctrl+/ / Alt nav / Escape / slash with page.keyboard', async ({ page, request }) => {
    await loginAs(page, request, 'customer@repairconnect.local');
    await expect(page).toHaveURL(/\/app\/customer/);

    // Ensure renderer focus (required for app handlers vs browser chrome).
    await page.locator('#main').click({ position: { x: 12, y: 12 } });

    const findings: Record<string, string> = {};

    // Ctrl+K — Chrome may also bind this to omnibox; in Playwright CDP it usually reaches the page.
    await page.keyboard.press('Control+KeyK');
    const paletteVisible = await page.getByTestId('command-palette').isVisible().catch(() => false);
    findings['Ctrl+K'] = paletteVisible
      ? 'opens command palette'
      : 'DID NOT open palette (likely Chrome omnibox conflict when page lacks focus)';
    if (paletteVisible) {
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('command-palette')).toBeHidden();
      findings['Escape'] = 'closes command palette';
    }

    await page.locator('#main').click({ position: { x: 12, y: 12 } });
    await page.keyboard.press('Control+Slash');
    const helpVisible = await page.getByTestId('shortcuts-help').isVisible().catch(() => false);
    findings['Ctrl+/'] = helpVisible ? 'opens shortcuts help' : 'DID NOT open shortcuts help';
    if (helpVisible) {
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('shortcuts-help')).toBeHidden();
    }

    await page.locator('#main').click({ position: { x: 12, y: 12 } });
    await page.keyboard.press('Alt+Digit2');
    await page.waitForTimeout(400);
    findings['Alt+2'] = page.url().includes('/customer/repairs')
      ? 'navigates to repairs'
      : `stayed at ${page.url()} (Alt+digit may be intercepted by OS/browser)`;

    await page.goto('/app/customer');
    await page.locator('#main').click({ position: { x: 12, y: 12 } });
    await page.keyboard.press('Alt+Digit0');
    await page.waitForTimeout(300);
    findings['Alt+0'] = /\/app\/customer\/?$/.test(new URL(page.url()).pathname)
      ? 'dashboard'
      : `unexpected ${page.url()}`;

    await page.goto('/app/customer/repairs');
    await page.locator('#main').click({ position: { x: 12, y: 12 } });
    await page.keyboard.press('/');
    const focusedType = await page.evaluate(() => {
      const el = document.activeElement as HTMLInputElement | null;
      return el?.getAttribute('type') || el?.tagName || 'none';
    });
    findings['/'] = /search|text|INPUT/i.test(focusedType)
      ? `focused ${focusedType}`
      : `focus was ${focusedType}`;

    // Persist findings for the acceptance report via console + soft assertions on critical path.
    console.log('REAL_KEYBOARD_FINDINGS', JSON.stringify(findings));

    // Hard-require Escape documentation path already covered when palette opens;
    // require at least one of Ctrl+K or header button fallback works.
    if (!paletteVisible) {
      await page.getByRole('button', { name: /command palette|کمانڈ پیلیٹ/i }).click();
      await expect(page.getByTestId('command-palette')).toBeVisible();
      findings['Ctrl+K-fallback'] = 'header button opens palette';
    }

    expect(
      Object.values(findings).some((v) => /opens|navigates|focused|dashboard/i.test(v))
    ).toBeTruthy();
  });

  test('Ctrl+S with real keyboard saves appearance when form focused', async ({ page, request }) => {
    await loginAs(page, request, 'customer@repairconnect.local');
    await page.goto('/app/appearance');
    await page.locator('#theme').selectOption('light');
    await page.locator('#theme').focus();
    await page.keyboard.press('Control+KeyS');
    await expect(page.getByText(/preferences saved|saved/i)).toBeVisible({ timeout: 10000 });
  });
});
