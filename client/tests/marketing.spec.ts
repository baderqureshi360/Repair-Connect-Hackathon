import { test, expect } from '@playwright/test';

test.describe('Public marketing website', () => {
  test('unauthenticated visitors see landing, not private dashboard', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page).not.toHaveURL(/\/app\//);
  });

  test('public entry routes load', async ({ page }) => {
    for (const path of ['/login', '/register', '/shop-registration', '/track', '/terms', '/privacy']) {
      await page.goto(path);
      await expect(page.locator('main, h1').first()).toBeVisible();
    }
  });

  test('track page accepts form fields accessibly', async ({ page }) => {
    await page.goto('/track');
    await expect(page.getByLabel(/Repair reference number/i)).toBeVisible();
    await expect(page.getByLabel(/Private tracking access code/i)).toBeVisible();
    await page.getByRole('button', { name: /Track Repair/i }).click();
    await expect(page.getByRole('heading', { name: /Track your repair/i })).toBeVisible();
  });

  test('shop registration form submits application', async ({ page }) => {
    await page.goto('/shop-registration');
    await expect(page.getByRole('heading', { name: /Register your repair shop/i })).toBeVisible();

    const stamp = Date.now();
    const email = `apply-${stamp}@example.com`;

    await page.locator('#ownerName').fill('Test Contact');
    await page.locator('#ownerEmail').fill(email);
    await page.locator('#ownerPhone').fill('03001234567');
    await page.locator('#password').fill('Password123!');
    await page.locator('#confirmPassword').fill('Password123!');
    await page.locator('#shopName').fill('Playwright Valley Repairs');
    await page.locator('#businessPhone').fill('03007654321');
    await page.locator('#businessEmail').fill(email);
    await page.locator('#address').fill('12 Test Road');
    await page.locator('#city').fill('Lahore');
    await page.locator('#region').fill('Punjab');
    await page.locator('#servicesDescription').fill(
      'Phones and laptops hardware repair services covering screens and batteries.'
    );
    await expect(page.locator('#ownerName')).toHaveValue('Test Contact');
    await expect(page.locator('#servicesDescription')).toHaveValue(/Phones and laptops/);

    // Click the label text so Svelte onchange updates serviceCategories state
    await page.locator('fieldset label').filter({ hasText: 'Mobile Phones & Tablets' }).click();
    await expect(page.getByRole('checkbox', { name: 'Mobile Phones & Tablets' })).toBeChecked();
    await page.getByRole('checkbox', { name: /I agree to the Terms/i }).check();
    await expect(page.getByRole('checkbox', { name: /I agree to the Terms/i })).toBeChecked();

    const responsePromise = page.waitForResponse(
      (r) =>
        r.url().includes('/api/v1/public/shop-applications/register') &&
        r.request().method() === 'POST',
      { timeout: 30_000 }
    );

    await page.getByRole('button', { name: /Submit application|Submit|جمع/i }).click();
    // Surface client-side validation failures instead of hanging on missing network call
    const clientError = page.getByRole('alert').filter({ hasText: /fix the highlighted|Select at least/i });
    await Promise.race([
      responsePromise,
      clientError.waitFor({ state: 'visible', timeout: 30_000 }).then(async () => {
        throw new Error(`Client validation blocked submit: ${await clientError.innerText()}`);
      })
    ]);
    const response = await responsePromise;
    const body = await response.json().catch(() => ({}));
    expect(response.ok(), `register API: ${response.status()} ${JSON.stringify(body)}`).toBeTruthy();

    await expect(page.getByRole('heading', { name: /Application submitted|درخواست/i })).toBeVisible({
      timeout: 10_000
    });
  });
});
