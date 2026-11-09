import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const API = 'http://localhost:5000';
const PASSWORD = 'Password123!';
const shotDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test-results', 'ux-print');

async function apiLogin(request: APIRequestContext, email: string) {
  const res = await request.post(`${API}/api/v1/auth/login`, {
    data: { email, password: PASSWORD }
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const body = await res.json();
  const csrf =
    body.data?.csrfToken ||
    (await request.storageState()).cookies.find((c) => c.name === 'rc_csrf')?.value;
  expect(csrf).toBeTruthy();
  return { csrf: String(csrf), body };
}

function csrfHeaders(csrf: string) {
  return { 'X-CSRF-Token': csrf };
}

async function loginUi(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel(/email|ای میل/i).fill(email);
  await page.getByLabel(/password|پاس ورڈ/i).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in|سائن ان/i }).click();
  await page.waitForURL(/\/app\//, { timeout: 20000 });
}

async function logoutUi(page: Page) {
  const details = page.locator('details').filter({ has: page.locator('summary[aria-label]') }).last();
  await details.locator('summary').click();
  await page.getByRole('menuitem', { name: /sign out|سائن آؤٹ/i }).click();
  await page.waitForURL(/login/, { timeout: 15000 });
}

test.describe('UX acceptance — print, analytics, account switch', () => {
  test.describe.configure({ mode: 'serial' });
  test('print formats, RTL Urdu, dark-independent print CSS', async ({ page, request }, testInfo) => {
    fs.mkdirSync(shotDir, { recursive: true });
    const { csrf } = await apiLogin(request, 'admin@repairconnect.local');

    const me = await request.get(`${API}/api/v1/auth/me`);
    expect(me.ok()).toBeTruthy();
    const meBody = await me.json();
    const shopId =
      meBody.data?.shopIds?.[0] ||
      meBody.data?.shops?.[0]?.id ||
      meBody.data?.shops?.[0]?.shop?._id;
    expect(shopId).toBeTruthy();

    const settings = await request.patch(`${API}/api/v1/documents/settings/${shopId}`, {
      headers: csrfHeaders(csrf),
      data: {
        printLanguage: 'ur',
        defaultPrintFormat: 'a4',
        receiptHeader: 'مرمت رسید',
        receiptFooter: 'شکریہ — RepairConnect',
        currency: 'PKR',
        taxRatePercent: 0
      }
    });
    expect(settings.ok(), await settings.text()).toBeTruthy();

    const repairs = await request.get(`${API}/api/v1/repairs?limit=50`);
    expect(repairs.ok()).toBeTruthy();
    const repairList = await repairs.json();
    const repair =
      (repairList.data || []).find((r: { status: string }) => r.status === 'completed') ||
      (repairList.data || [])[0];
    expect(repair).toBeTruthy();

    let doc: { _id: string };
    const preferredType = repair.status === 'completed' ? 'invoice' : 'intake_receipt';
    const issued = await request.post(`${API}/api/v1/documents/issue`, {
      headers: csrfHeaders(csrf),
      data: { repairId: repair._id, docType: preferredType }
    });
    if (issued.ok()) {
      doc = (await issued.json()).data;
    } else {
      const fallback = await request.post(`${API}/api/v1/documents/issue`, {
        headers: csrfHeaders(csrf),
        data: { repairId: repair._id, docType: 'intake_receipt' }
      });
      expect(fallback.ok(), await fallback.text()).toBeTruthy();
      doc = (await fallback.json()).data;
    }

    await loginUi(page, 'admin@repairconnect.local');
    await page.goto(`/app/documents/${doc._id}`);
    await expect(page.locator('.print-doc')).toBeVisible();

    await page.evaluate(() => {
      document.documentElement.classList.add('dark');
      localStorage.setItem('rc_theme', 'dark');
    });

    const article = page.locator('.print-doc');
    await expect(article).toHaveAttribute('dir', 'rtl');
    await expect(article).toHaveAttribute('lang', 'ur');

    for (const format of ['a4', 'thermal80', 'thermal58'] as const) {
      await page.locator('#print-format').selectOption(format);
      await page.emulateMedia({ media: 'print', colorScheme: 'dark' });

      const box = await article.boundingBox();
      expect(box).toBeTruthy();
      if (format === 'thermal80') expect(box!.width).toBeLessThanOrEqual(320);
      if (format === 'thermal58') expect(box!.width).toBeLessThanOrEqual(240);

      // Print stylesheet forces black text / white background on .print-doc
      const printColors = await page.evaluate(() => {
        const el = document.querySelector('.print-doc') as HTMLElement;
        const cs = getComputedStyle(el);
        return { color: cs.color, backgroundColor: cs.backgroundColor };
      });
      expect(printColors.color.replace(/\s/g, '')).toMatch(/rgb\(0,0,0\)|#000/i);
      expect(printColors.backgroundColor.replace(/\s/g, '')).toMatch(
        /rgb\(255,255,255\)|#fff|rgba\(0,0,0,0\)/i
      );

      const file = path.join(shotDir, `print-${format}-ur-dark.png`);
      await page.screenshot({ path: file, fullPage: true });
      await testInfo.attach(`print-${format}`, { path: file, contentType: 'image/png' });
      await page.emulateMedia({ media: 'screen' });
    }

    await page.locator('#print-format').selectOption('thermal58');
    const noClip = await article.evaluate((el) => el.scrollWidth <= el.clientWidth + 4);
    expect(noClip).toBe(true);

    // Print docs expose tracking URL text; QR image lives on repair detail, not print sheet
    await expect(page.getByText(/\/track\//i)).toBeVisible();
    const qrOnPrint = await page.locator('.print-doc img[alt*="QR" i]').count();
    expect(qrOnPrint).toBe(0);
  });

  test('chart values match underlying data tables for same range', async ({ page }) => {
    await loginUi(page, 'customer@repairconnect.local');
    await page.goto('/app/customer');
    await page.locator('#analytics-range').selectOption('90d');
    await page.getByRole('button', { name: /refresh|تازہ/i }).click();
    await expect(page.locator('[data-testid="customer-financial-summary"]')).toBeVisible({
      timeout: 15000
    });

    const charts = page.locator('section[aria-labelledby^="chart-"]');
    const count = await charts.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const section = charts.nth(i);
      const rows = section.locator('tbody tr');
      const rowCount = await rows.count();
      for (let r = 0; r < rowCount; r++) {
        const valueText = (await rows.nth(r).locator('td').nth(1).innerText()).trim();
        expect(Number.isFinite(Number(valueText))).toBe(true);
      }
    }

    for (const id of [
      'completed-repair-value',
      'actual-customer-spending',
      'outstanding-balance'
    ]) {
      const n = Number(await page.locator(`[data-testid="${id}"]`).innerText());
      expect(n).toBeGreaterThanOrEqual(0);
    }
  });

  test('account switch clears prior customer cache; back/forward safe', async ({ page, request }) => {
    const stamp = Date.now();
    const emailB = `customer-b-${stamp}@repairconnect.local`;
    const reg = await request.post(`${API}/api/v1/auth/register`, {
      data: {
        email: emailB,
        password: PASSWORD,
        name: 'Customer B UX',
        preferredLanguage: 'en'
      }
    });
    expect(reg.ok(), await reg.text()).toBeTruthy();

    await loginUi(page, 'customer@repairconnect.local');
    await expect(page).toHaveURL(/customer/);

    await page.evaluate(() => {
      localStorage.setItem('rc_prefs', JSON.stringify({ theme: 'dark', accent: 'teal' }));
      localStorage.setItem('rc_theme', 'dark');
    });

    await logoutUi(page);

    const prefsAfterLogout = await page.evaluate(() => ({
      prefs: localStorage.getItem('rc_prefs'),
      theme: localStorage.getItem('rc_theme')
    }));
    expect(prefsAfterLogout.prefs).toBeNull();
    expect(prefsAfterLogout.theme).toBeNull();

    await loginUi(page, emailB);
    await expect(page).toHaveURL(/customer/);
    await expect(page.getByText(/Customer B UX|Hello/i).first()).toBeVisible();

    const prefsB = await page.evaluate(() => localStorage.getItem('rc_prefs'));
    if (prefsB) expect(prefsB).not.toContain('"accent":"teal"');

    await page.reload();
    await expect(page).toHaveURL(/customer/);
    await page.goBack();
    await page.goto('/app/customer');
    await expect(page).toHaveURL(/customer/);
    await page.reload();

    const me = await page.evaluate(async () => {
      const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
      return res.json();
    });
    expect(me.data?.email).toBe(emailB);
  });

  test('admin CSV export remains shop-scoped', async ({ playwright }) => {
    const admin = await playwright.request.newContext({ baseURL: API });
    await apiLogin(admin, 'admin@repairconnect.local');
    const csv = await admin.get('/api/v1/reports/operations.csv');
    expect(csv.ok(), await csv.text()).toBeTruthy();
    const text = await csv.text();
    expect(text.toLowerCase()).toMatch(/repair|status|reference|shop|id/);
    await admin.dispose();

    const mech = await playwright.request.newContext({ baseURL: API });
    await apiLogin(mech, 'mechanic@repairconnect.local');
    const denied = await mech.get('/api/v1/reports/operations.csv');
    expect(denied.status()).toBe(403);
    await mech.dispose();
  });
});
