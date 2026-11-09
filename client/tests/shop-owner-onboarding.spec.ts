import { test, expect } from '@playwright/test';

const password = 'SecurePass1';
const stamp = Date.now();
const email = `pw.owner.${stamp}@example.com`;

test.describe('Shop owner registration & pending status', () => {
  test('register shop owner, sign in to status page, cannot open admin', async ({ page }) => {
    await page.goto('/shop-registration');
    await expect(page.getByRole('heading', { name: /register your repair shop/i })).toBeVisible();

    await page.getByLabel(/^full name|^name/i).first().fill('Playwright Owner');
    await page.locator('#ownerEmail').fill(email);
    await page.locator('#ownerPhone').fill('+92-300-7770001');
    await page.locator('#password').fill(password);
    await page.locator('#confirmPassword').fill(password);

    await page.locator('#shopName').fill(`PW Shop ${stamp}`);
    await page.locator('#businessPhone').fill('+92-42-7770002');
    await page.locator('#businessEmail').fill(email);
    await page.locator('#address').fill('99 Playwright Avenue');
    await page.locator('#city').fill('Lahore');
    await page.locator('#region').fill('Punjab');
    await page.getByLabel(/mobile phones/i).check();
    await page.locator('#servicesDescription').fill('Full device repair coverage for phones and laptops.');
    await page.getByRole('checkbox', { name: /agree|terms/i }).check();
    await page.getByRole('button', { name: /submit application/i }).click();

    await expect(page.getByText(/application submitted/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/SA-/i)).toBeVisible();

    await page.getByRole('link', { name: /repair shop sign in/i }).click();
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page).toHaveURL(/\/app\/shop-application\/status/, { timeout: 15000 });
    await expect(page.getByText(/pending review|pending/i)).toBeVisible();

    await page.goto('/app/admin');
    await expect(page).toHaveURL(/\/app\/shop-application\/status/, { timeout: 15000 });
  });
});
