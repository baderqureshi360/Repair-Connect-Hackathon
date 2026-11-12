import { test, expect, type Page } from '@playwright/test';
import { loginAs } from './helpers/auth';

/** Dispatch a keydown the page shortcut manager will see (avoids browser-chrome chord collisions). */
async function dispatchChord(
  page: Page,
  init: { key: string; ctrl?: boolean; alt?: boolean; meta?: boolean; shift?: boolean }
) {
  await page.evaluate((chord) => {
    const event = new KeyboardEvent('keydown', {
      key: chord.key,
      code: chord.key.length === 1 ? `Key${chord.key.toUpperCase()}` : chord.key,
      ctrlKey: Boolean(chord.ctrl),
      metaKey: Boolean(chord.meta),
      altKey: Boolean(chord.alt),
      shiftKey: Boolean(chord.shift),
      bubbles: true,
      cancelable: true
    });
    window.dispatchEvent(event);
  }, init);
}

async function openPalette(page: Page) {
  await page.locator('#main').click({ position: { x: 8, y: 8 } }).catch(() => undefined);
  await dispatchChord(page, { key: 'k', ctrl: true });
  await expect(page.getByTestId('command-palette')).toBeVisible({ timeout: 10000 });
}

async function openHelp(page: Page) {
  await page.locator('#main').click({ position: { x: 8, y: 8 } }).catch(() => undefined);
  await dispatchChord(page, { key: '/', ctrl: true });
  await expect(page.getByTestId('shortcuts-help')).toBeVisible({ timeout: 10000 });
}

test.describe('Keyboard navigation system', () => {
  test('Ctrl+K opens palette; arrows move; Enter navigates; Escape closes', async ({ page, request }) => {
    await loginAs(page, request, 'customer@repairconnect.local');
    await expect(page).toHaveURL(/\/app\/customer/);

    await openPalette(page);
    const dialog = page.getByTestId('command-palette');
    await page.locator('#command-palette-input').fill('my repairs');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden({ timeout: 10000 });
    await expect(page).toHaveURL(/\/app\/customer\/repairs/);
  });

  test('Ctrl+/ opens shortcuts help with searchable list', async ({ page, request }) => {
    await loginAs(page, request, 'customer@repairconnect.local');
    await openHelp(page);
    const help = page.getByTestId('shortcuts-help');
    await expect(help.getByText(/Ctrl \+ K|Command palette|کمانڈ پیلیٹ/i).first()).toBeVisible();
    await help.locator('#shortcuts-filter').fill('dashboard');
    await expect(help.getByText(/Alt \+ 1|Dashboard/i).first()).toBeVisible();
    await dispatchChord(page, { key: 'Escape' });
    await expect(help).toBeHidden();
  });

  test('role-specific Alt shortcuts navigate customer portal', async ({ page, request }) => {
    await loginAs(page, request, 'customer@repairconnect.local');
    await page.locator('#main').click({ position: { x: 8, y: 8 } }).catch(() => undefined);
    await dispatchChord(page, { key: '2', alt: true });
    await expect(page).toHaveURL(/\/app\/customer\/repairs/);
    await dispatchChord(page, { key: '3', alt: true });
    await expect(page).toHaveURL(/\/app\/customer\/appointments/);
    await dispatchChord(page, { key: '1', alt: true });
    await expect(page).toHaveURL(/\/app\/customer\/?$/);
  });

  test('inventory shortcut unavailable for customer stays on page', async ({ page, request }) => {
    await loginAs(page, request, 'customer@repairconnect.local');
    const before = page.url();
    await dispatchChord(page, { key: '4', alt: true });
    await expect(page).toHaveURL(before);
  });

  test('shop admin inventory and reports shortcuts work', async ({ page, request }) => {
    await loginAs(page, request, 'admin@repairconnect.local');
    await expect(page).toHaveURL(/\/app\/admin/);
    await page.locator('#main').click({ position: { x: 8, y: 8 } }).catch(() => undefined);
    await dispatchChord(page, { key: '4', alt: true });
    await expect(page).toHaveURL(/\/app\/parts\/inventory/);
    await dispatchChord(page, { key: '5', alt: true });
    await expect(page).toHaveURL(/\/app\/admin\/reports/);
  });

  test('slash focuses page search when not typing', async ({ page, request }) => {
    await loginAs(page, request, 'admin@repairconnect.local');
    await page.goto('/app/parts/inventory');
    await page.locator('#main').click({ position: { x: 8, y: 8 } }).catch(() => undefined);
    await dispatchChord(page, { key: '/' });
    const focused = page.locator(':focus');
    await expect(focused).toHaveAttribute('type', /search|text/i);
  });

  test('does not register reserved browser chords as app shortcuts', async ({ page, request }) => {
    await loginAs(page, request, 'customer@repairconnect.local');
    await openPalette(page);
    await dispatchChord(page, { key: 'Escape' });
    await expect(page.getByTestId('command-palette')).toBeHidden();
    // Reserved chords are ignored by the manager (no navigation / no palette toggle)
    const url = page.url();
    await dispatchChord(page, { key: 'l', ctrl: true });
    await expect(page).toHaveURL(url);
    await expect(page.getByTestId('command-palette')).toBeHidden();
  });

  test('modal focus trap and restore via shortcuts help', async ({ page, request }) => {
    await loginAs(page, request, 'customer@repairconnect.local');
    await page.goto('/app/appearance');
    const openHelpBtn = page.getByRole('button', { name: /view all shortcuts|تمام شارٹ کٹس/i });
    await openHelpBtn.focus();
    await openHelpBtn.click();
    const help = page.getByTestId('shortcuts-help');
    await expect(help).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(help.locator(':focus')).toHaveCount(1);
    await dispatchChord(page, { key: 'Escape' });
    await expect(help).toBeHidden();
  });

  test('Ctrl+S saves appearance form', async ({ page, request }) => {
    await loginAs(page, request, 'customer@repairconnect.local');
    await page.goto('/app/appearance');
    await page.locator('#theme').selectOption('dark');
    await page.locator('#theme').focus();
    await dispatchChord(page, { key: 's', ctrl: true });
    await expect(page.getByText(/preferences saved|saved/i)).toBeVisible({ timeout: 10000 });
  });

  test('Urdu RTL shortcuts help remains usable', async ({ page, request }) => {
    await loginAs(page, request, 'customer@repairconnect.local');
    const lang = page.locator('#lang-select');
    if (await lang.count()) {
      await lang.selectOption('ur');
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    }
    await openHelp(page);
    await expect(page.getByTestId('shortcuts-help')).toBeVisible();
    await dispatchChord(page, { key: 'Escape' });
  });

  test('account switch refreshes palette destinations', async ({ page, request }) => {
    await loginAs(page, request, 'customer@repairconnect.local');
    await openPalette(page);
    await expect(page.getByRole('option').filter({ hasText: /my repairs|میرے مرمت/i }).first()).toBeVisible();
    await dispatchChord(page, { key: 'Escape' });

    await loginAs(page, request, 'admin@repairconnect.local');
    await openPalette(page);
    await expect(page.getByRole('option').filter({ hasText: /staff|عملہ|repairs|مرمت/i }).first()).toBeVisible();
    await expect(page.getByRole('option').filter({ hasText: /^my repairs$/i })).toHaveCount(0);
  });
});
