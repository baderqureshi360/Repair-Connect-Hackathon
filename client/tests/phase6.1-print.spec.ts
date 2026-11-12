import { test, expect, type APIRequestContext } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Phase 6.1 — actual Chromium print-to-PDF verification (not CSS-only).
 */

const OUT = path.join(process.cwd(), 'test-results', 'phase6.1-print');

function assertPdf(buf: Buffer, label: string) {
  expect(buf.byteLength, `${label} empty`).toBeGreaterThan(800);
  expect(buf.subarray(0, 4).toString(), `${label} not PDF`).toBe('%PDF');
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${label}.pdf`), buf);
}

function cookieHeader(res: { headers: () => Record<string, string> }) {
  const raw = res.headers()['set-cookie'];
  if (!raw) return '';
  return (Array.isArray(raw) ? raw : [raw]).map((c) => c.split(';')[0]).join('; ');
}

async function adminSession(request: APIRequestContext) {
  const loginRes = await request.post('http://localhost:5000/api/v1/auth/login', {
    data: { email: 'admin@repairconnect.local', password: 'Password123!' }
  });
  return { ok: loginRes.ok(), cookie: cookieHeader(loginRes), json: await loginRes.json() };
}

test.describe('Phase 6.1 print verification (Chromium PDF)', () => {
  test('document print formats A4 / 80mm / 58mm produce PDFs', async ({ page, request, context }) => {
    const admin = await adminSession(request);
    test.skip(!admin.ok, 'Demo admin unavailable');

    const docs = await request.get('http://localhost:5000/api/v1/documents?limit=5', {
      headers: { Cookie: admin.cookie }
    });
    test.skip(!docs.ok(), 'Documents API unavailable');
    const items = ((await docs.json()).data || []) as Array<{
      id?: string;
      _id?: string;
      documentNumber?: string;
    }>;
    test.skip(!items.length, 'No financial documents to print');
    const docId = String(items[0].id || items[0]._id || '');
    test.skip(!docId, 'Document list item missing id');

    // Establish HttpOnly cookies + client session flag (rc_user) used by AppShell guards
    await page.goto('/login');
    const sessionOk = await page.evaluate(async () => {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: 'admin@repairconnect.local', password: 'Password123!' })
      });
      if (!res.ok) return false;
      const body = await res.json();
      localStorage.setItem('rc_user', JSON.stringify(body.data.user));
      return true;
    });
    test.skip(!sessionOk, 'Admin browser session bootstrap failed');
    await page.goto('/app/admin');
    await page.waitForURL(/\/app\//, { timeout: 30000 });
    await page.goto(`/app/documents/${docId}`);
    await expect(page.locator('.print-doc')).toBeVisible({ timeout: 20000 });

    await page.evaluate(() => {
      const h = document.querySelector('.print-doc h1, .print-doc h2');
      if (h) {
        h.textContent = `${h.textContent || ''} — محمد علی خان — Very Long Customer Name With Extra Detail `.repeat(2);
      }
    });

    for (const format of ['a4', 'thermal80', 'thermal58'] as const) {
      await page.locator('#print-format').selectOption(format);
      await page.emulateMedia({ media: 'print' });
      const pdf = await page.pdf({
        printBackground: true,
        preferCSSPageSize: true,
        ...(format === 'a4'
          ? { format: 'A4' as const }
          : {
              width: format === 'thermal80' ? '80mm' : '58mm',
              height: '220mm'
            })
      });
      assertPdf(Buffer.from(pdf), `document-${format}`);
      await page.emulateMedia({ media: 'screen' });
    }

    const lang = page.locator('#lang-select');
    if (await lang.count()) {
      await lang.selectOption('ur');
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await page.emulateMedia({ media: 'print' });
      assertPdf(Buffer.from(await page.pdf({ format: 'A4', printBackground: true })), 'document-a4-urdu-rtl');
    }
  });

  test('purchasing analytics print media hides chrome and yields PDF', async ({ page }) => {
    await page.goto('/login');
    const loginOk = await page.evaluate(async () => {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: 'admin@repairconnect.local', password: 'Password123!' })
      });
      if (!res.ok) return false;
      const body = await res.json();
      localStorage.setItem('rc_user', JSON.stringify(body.data.user));
      return true;
    });
    test.skip(!loginOk, 'Admin login failed');
    await page.goto('/app/admin/purchasing-analytics');
    await expect(page.locator('h1')).toBeVisible({ timeout: 20000 });

    await page.emulateMedia({ media: 'print' });
    const hidden = await page.locator('.no-print').evaluateAll((nodes) =>
      nodes.length === 0 ? true : nodes.every((n) => getComputedStyle(n).display === 'none')
    );
    expect(hidden).toBe(true);
    assertPdf(Buffer.from(await page.pdf({ format: 'A4', printBackground: true })), 'purchasing-analytics-a4');
  });
});
