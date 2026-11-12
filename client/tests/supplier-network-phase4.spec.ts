import { test, expect, type APIRequestContext, type Browser, type Page } from '@playwright/test';

const API = 'http://localhost:5000';
const PASSWORD = 'Password123!';
const SUP_PASS = 'SecurePass1';
const PLATFORM_OPS = 'p4.e2e.ops@repairconnect.local';

async function apiLogin(request: APIRequestContext, email: string, password = PASSWORD) {
  const existingCsrf = (await request.storageState()).cookies.find((c) => c.name === 'rc_csrf')
    ?.value;
  const res = await request.post(`${API}/api/v1/auth/login`, {
    headers: existingCsrf ? { 'X-CSRF-Token': existingCsrf } : undefined,
    data: { email, password }
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const body = await res.json();
  const csrf =
    body.data?.csrfToken ||
    (await request.storageState()).cookies.find((c) => c.name === 'rc_csrf')?.value;
  expect(csrf).toBeTruthy();
  return { csrf: String(csrf), body, user: body.data.user };
}

async function seedPageSession(page: Page, request: APIRequestContext, user: unknown) {
  const state = await request.storageState();
  await page.context().clearCookies();
  await page.context().addCookies(
    state.cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: 'localhost',
      path: c.path || '/',
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: (c.sameSite as 'Lax' | 'Strict' | 'None') || 'Lax'
    }))
  );
  await page.goto('/login');
  await page.evaluate((u) => {
    localStorage.setItem('rc_user', JSON.stringify(u));
    localStorage.removeItem('rc_token');
  }, user);
}

async function openRoleHome(page: Page, role: string) {
  const home =
    role === 'supplier'
      ? '/app/supplier'
      : role === 'parts_coordinator'
        ? '/app/parts'
        : role === 'customer'
          ? '/app/customer'
          : '/app/admin';
  await page.goto(home);
  await page.waitForURL(/\/app\//, { timeout: 20000 });
}

async function freshContext(browser: Browser) {
  const ctx = await browser.newContext();
  return { ctx, request: ctx.request, page: await ctx.newPage() };
}

test.describe('Supplier Network Phase 4 E2E', () => {
  test.describe.configure({ mode: 'serial' });

  test('PO issue → acknowledge → ship → receive → GRN print → payable', async ({ browser }) => {
    test.setTimeout(180000);
    const stamp = Date.now();
    const supplierEmail = `p4.e2e.sup.${stamp}@example.com`;

    const ops = await freshContext(browser);
    const admin = await freshContext(browser);
    const supplier = await freshContext(browser);
    const parts = await freshContext(browser);

    try {
      // Register supplier (public — no auth)
      const reg = await admin.request.post(`${API}/api/v1/public/supplier-applications/register`, {
        data: {
          contactPerson: 'E2E Supplier',
          email: supplierEmail,
          phone: '+92-300-7770001',
          password: SUP_PASS,
          confirmPassword: SUP_PASS,
          businessName: `E2E Hub ${stamp}`,
          address: '10 E2E Street',
          city: 'Lahore',
          region: 'Punjab',
          description: 'Playwright Phase 4 supplier for purchase order and receiving workflow.',
          partCategories: ['screens_displays'],
          supportedBrands: ['Samsung'],
          deliveryCities: ['Lahore'],
          termsAccepted: true
        }
      });
      expect(reg.ok(), await reg.text()).toBeTruthy();
      const applicationId = (await reg.json()).data.id;

      const opsSession = await apiLogin(ops.request, PLATFORM_OPS);
      const approve = await ops.request.post(
        `${API}/api/v1/platform/supplier-applications/${applicationId}/approve`,
        { headers: { 'X-CSRF-Token': opsSession.csrf }, data: {} }
      );
      expect(approve.ok(), await approve.text()).toBeTruthy();

      const adminSession = await apiLogin(admin.request, 'admin@repairconnect.local');
      const shopId = String(
        adminSession.body.data.user?.shops?.[0]?.id ||
          adminSession.body.data.user?.shops?.[0]?.shop?._id ||
          adminSession.body.data.user?.shopIds?.[0] ||
          ''
      );
      expect(shopId).toBeTruthy();

      const market = await admin.request.get(
        `${API}/api/v1/marketplace/suppliers?q=${encodeURIComponent(`E2E Hub ${stamp}`)}`,
        { headers: { 'X-CSRF-Token': adminSession.csrf } }
      );
      expect(market.ok(), await market.text()).toBeTruthy();
      const supplierBiz = ((await market.json()).data?.items || []).find(
        (s: { businessName: string }) => String(s.businessName).includes(String(stamp))
      );
      expect(supplierBiz, 'marketplace supplier visible').toBeTruthy();

      const rfq = await admin.request.post(`${API}/api/v1/supplier-network/rfqs`, {
        headers: { 'X-CSRF-Token': adminSession.csrf },
        data: {
          shopId,
          title: `E2E OLED RFQ ${stamp}`,
          supplierBusinessIds: [supplierBiz.id],
          items: [{ name: 'E2E OLED Panel', quantity: 4, sku: 'E2E-OLED' }],
          send: true
        }
      });
      expect(rfq.ok(), await rfq.text()).toBeTruthy();
      const rfqData = (await rfq.json()).data;

      const supplierSession = await apiLogin(supplier.request, supplierEmail, SUP_PASS);
      const quote = await supplier.request.post(
        `${API}/api/v1/supplier-network/rfqs/${rfqData.publicId}/quotations`,
        {
          headers: { 'X-CSRF-Token': supplierSession.csrf },
          data: {
            lines: [
              {
                rfqLineId: rfqData.items[0].lineId,
                unitPrice: 8000,
                availableQuantity: 20,
                quotedQuantity: 4
              }
            ],
            deliveryCharges: 200
          }
        }
      );
      expect(quote.ok(), await quote.text()).toBeTruthy();
      const quoteData = (await quote.json()).data;

      const accept = await admin.request.post(
        `${API}/api/v1/supplier-network/rfqs/${rfqData.publicId}/accept`,
        {
          headers: { 'X-CSRF-Token': adminSession.csrf },
          data: { quotationId: quoteData.id }
        }
      );
      expect(accept.ok(), await accept.text()).toBeTruthy();

      const beforeJson = await (
        await admin.request.get(`${API}/api/v1/parts?shopId=${shopId}&q=OLED`, {
          headers: { 'X-CSRF-Token': adminSession.csrf }
        })
      ).json();
      const beforeQty = (Array.isArray(beforeJson.data) ? beforeJson.data : [])
        .filter((p: { name?: string }) => String(p.name || '').includes('OLED'))
        .reduce(
          (s: number, p: { quantityAvailable?: number }) => s + Number(p.quantityAvailable || 0),
          0
        );

      // Admin UI: create PO from RFQ
      await seedPageSession(admin.page, admin.request, adminSession.user);
      await openRoleHome(admin.page, 'shop_admin');
      await admin.page.goto(`/app/admin/rfqs/${rfqData.publicId}`);
      await expect(
        admin.page.getByRole('heading', { name: new RegExp(`E2E OLED RFQ ${stamp}`) })
      ).toBeVisible({ timeout: 15000 });
      await admin.page.getByRole('button', { name: /create purchase order|خریداری آرڈر/i }).click();
      await admin.page.waitForURL(/\/app\/admin\/purchase-orders\/PO-/i, { timeout: 20000 });
      const poMatch = admin.page.url().match(/PO-[A-Z0-9]+/i);
      expect(poMatch).toBeTruthy();
      const poPublicId = poMatch![0];

      // Supplier UI: acknowledge + ship
      await seedPageSession(supplier.page, supplier.request, supplierSession.user);
      await openRoleHome(supplier.page, 'supplier');
      await supplier.page.goto(`/app/supplier/purchase-orders/${poPublicId}`);
      await expect(supplier.page.getByText(poPublicId)).toBeVisible({ timeout: 15000 });
      await supplier.page.getByRole('button', { name: /acknowledge|تسلیم/i }).click();
      await expect(supplier.page.getByText('PO acknowledged.')).toBeVisible({ timeout: 15000 });
      await supplier.page.locator('#carrier').fill('TCS');
      await supplier.page.locator('#tracking').fill(`E2E-${stamp}`);
      await supplier.page.getByRole('button', { name: /dispatch shipment|شپمنٹ/i }).click();
      await expect(
        supplier.page.getByText(/Shipment dispatched|not fulfilled until/i).first()
      ).toBeVisible({ timeout: 15000 });

      // Create parts coordinator once
      const pcEmail = `pc.p4.e2e.${stamp}@repairconnect.test`;
      const createPc = await admin.request.post(`${API}/api/v1/auth/staff`, {
        headers: { 'X-CSRF-Token': adminSession.csrf },
        data: {
          email: pcEmail,
          password: PASSWORD,
          name: `PC P4 ${stamp}`,
          role: 'parts_coordinator',
          shopId,
          phone: '03001112233',
          invite: true
        }
      });
      expect(createPc.ok(), await createPc.text()).toBeTruthy();

      const partsSession = await apiLogin(parts.request, pcEmail);
      await seedPageSession(parts.page, parts.request, partsSession.user);
      await openRoleHome(parts.page, 'parts_coordinator');
      await parts.page.goto(`/app/admin/purchase-orders/${poPublicId}`);
      await expect(parts.page.getByText(poPublicId)).toBeVisible({ timeout: 15000 });
      await parts.page.getByRole('button', { name: /receive goods|سامان وصول/i }).click();
      await expect(parts.page.getByText(/GRN .+ posted/i)).toBeVisible({ timeout: 20000 });
      const grnLink = parts.page.locator('a', { hasText: /print grn|GRN پرنٹ/i }).first();
      await expect(grnLink).toBeVisible({ timeout: 15000 });
      const href = await grnLink.getAttribute('href');
      expect(href).toMatch(/\/app\/admin\/goods-receipts\/GRN-/i);
      await parts.page.goto(href!);
      await expect(parts.page.getByText(/Goods Received Note/i)).toBeVisible({ timeout: 15000 });

      // Inventory only accepted qty
      const afterJson = await (
        await admin.request.get(`${API}/api/v1/parts?shopId=${shopId}&q=OLED`, {
          headers: { 'X-CSRF-Token': adminSession.csrf }
        })
      ).json();
      const afterQty = (Array.isArray(afterJson.data) ? afterJson.data : [])
        .filter((p: { name?: string }) => String(p.name || '').includes('OLED'))
        .reduce(
          (s: number, p: { quantityAvailable?: number }) => s + Number(p.quantityAvailable || 0),
          0
        );
      expect(afterQty - beforeQty).toBe(4);

      // Partial receive via API (same sessions — no extra logins)
      const rfq2 = await admin.request.post(`${API}/api/v1/supplier-network/rfqs`, {
        headers: { 'X-CSRF-Token': adminSession.csrf },
        data: {
          shopId,
          title: `E2E Partial RFQ ${stamp}`,
          supplierBusinessIds: [supplierBiz.id],
          items: [{ name: 'E2E Battery', quantity: 6, sku: 'E2E-BAT' }],
          send: true
        }
      });
      expect(rfq2.ok(), await rfq2.text()).toBeTruthy();
      const rfq2Data = (await rfq2.json()).data;
      const quote2 = await supplier.request.post(
        `${API}/api/v1/supplier-network/rfqs/${rfq2Data.publicId}/quotations`,
        {
          headers: { 'X-CSRF-Token': supplierSession.csrf },
          data: {
            lines: [
              {
                rfqLineId: rfq2Data.items[0].lineId,
                unitPrice: 1000,
                availableQuantity: 20,
                quotedQuantity: 6
              }
            ]
          }
        }
      );
      expect(quote2.ok(), await quote2.text()).toBeTruthy();
      const quote2Data = (await quote2.json()).data;
      const accept2 = await admin.request.post(
        `${API}/api/v1/supplier-network/rfqs/${rfq2Data.publicId}/accept`,
        {
          headers: { 'X-CSRF-Token': adminSession.csrf },
          data: { quotationId: quote2Data.id }
        }
      );
      expect(accept2.ok(), await accept2.text()).toBeTruthy();
      const po2 = await admin.request.post(`${API}/api/v1/supplier-network/purchase-orders`, {
        headers: { 'X-CSRF-Token': adminSession.csrf },
        data: { rfqId: rfq2Data.publicId, issue: true }
      });
      expect(po2.ok(), await po2.text()).toBeTruthy();
      const po2Data = (await po2.json()).data;
      const ack2 = await supplier.request.post(
        `${API}/api/v1/supplier-network/purchase-orders/${po2Data.publicId}/acknowledge`,
        { headers: { 'X-CSRF-Token': supplierSession.csrf }, data: {} }
      );
      expect(ack2.ok(), await ack2.text()).toBeTruthy();
      const partialGrn = await admin.request.post(`${API}/api/v1/supplier-network/goods-receipts`, {
        headers: { 'X-CSRF-Token': adminSession.csrf },
        data: {
          purchaseOrderId: po2Data.publicId,
          idempotencyKey: `e2e-partial-${stamp}`,
          lines: [
            {
              poLineId: po2Data.lines[0].lineId,
              quantityAccepted: 2,
              quantityRejected: 1,
              rejectReason: 'Wrong revision shipped',
              quantityDamaged: 1,
              damageReason: 'Cracked case'
            }
          ]
        }
      });
      expect(partialGrn.ok(), await partialGrn.text()).toBeTruthy();
      const partialBody = (await partialGrn.json()).data;
      expect(partialBody.totalAcceptedValue).toBe(2000);
      expect(partialBody.lines[0].quantityAccepted).toBe(2);

      // Finance searchable selector
      await admin.page.goto('/app/admin/supplier-finance');
      await expect(
        admin.page.getByRole('heading', { name: /supplier finance|سپلائر مالیات/i })
      ).toBeVisible({ timeout: 15000 });
      await admin.page.locator('#supplier-search').fill(`E2E Hub ${stamp}`);
      await expect(
        admin.page.getByRole('option', { name: new RegExp(`E2E Hub ${stamp}`) })
      ).toBeVisible({ timeout: 15000 });
      await admin.page.getByRole('option', { name: new RegExp(`E2E Hub ${stamp}`) }).click();
      await expect(admin.page.getByText(/Contact:|Phone:|Email:/i).first()).toBeVisible({
        timeout: 10000
      });

      // Unauthorized supplier access to finance
      await supplier.page.goto('/app/admin/supplier-finance');
      await expect(supplier.page).not.toHaveURL(/supplier-finance/, { timeout: 15000 });
    } finally {
      await ops.ctx.close();
      await admin.ctx.close();
      await supplier.ctx.close();
      await parts.ctx.close();
    }
  });

  test('customer cannot access purchase orders', async ({ browser }) => {
    // Small pause to avoid auth rate limit after previous test
    await new Promise((r) => setTimeout(r, 2000));
    const customer = await freshContext(browser);
    try {
      const session = await apiLogin(customer.request, 'customer@repairconnect.local');
      await seedPageSession(customer.page, customer.request, session.user);
      await openRoleHome(customer.page, 'customer');
      await customer.page.goto('/app/admin/purchase-orders');
      await expect(customer.page).toHaveURL(/\/app\/customer/, { timeout: 15000 });
    } finally {
      await customer.ctx.close();
    }
  });
});
