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
      : role === 'platform_operator'
        ? '/app/platform/supplier-reviews'
        : '/app/admin';
  await page.goto(home);
  await page.waitForURL(/\/app\//, { timeout: 20000 });
}

async function freshContext(browser: Browser) {
  const ctx = await browser.newContext();
  return { ctx, request: ctx.request, page: await ctx.newPage() };
}

const stars = {
  productQuality: 5,
  deliveryPerformance: 4,
  communication: 5,
  orderFulfilment: 4,
  overallExperience: 5
};

test.describe('Supplier Network Phase 5A E2E', () => {
  test.describe.configure({ mode: 'serial' });

  test('review submit → edit → supplier response → report → marketplace', async ({ browser }) => {
    test.setTimeout(300000);
    const stamp = Date.now();
    const supplierEmail = `p5a.e2e.sup.${stamp}@example.com`;

    const ops = await freshContext(browser);
    const admin = await freshContext(browser);
    const supplier = await freshContext(browser);
    const outsider = await freshContext(browser);

    try {
      const reg = await admin.request.post(`${API}/api/v1/public/supplier-applications/register`, {
        data: {
          contactPerson: 'P5A E2E Supplier',
          email: supplierEmail,
          phone: '+92-300-7770002',
          password: SUP_PASS,
          confirmPassword: SUP_PASS,
          businessName: `P5A Hub ${stamp}`,
          address: '11 Review Street',
          city: 'Lahore',
          region: 'Punjab',
          description: 'Playwright Phase 5A supplier for verified reviews and performance display.',
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
        `${API}/api/v1/marketplace/suppliers?q=${encodeURIComponent(`P5A Hub ${stamp}`)}`,
        { headers: { 'X-CSRF-Token': adminSession.csrf } }
      );
      expect(market.ok(), await market.text()).toBeTruthy();
      const supplierBiz = ((await market.json()).data?.items || []).find((s: { businessName: string }) =>
        String(s.businessName).includes(String(stamp))
      );
      expect(supplierBiz, 'marketplace supplier visible').toBeTruthy();

      const rfq = await admin.request.post(`${API}/api/v1/supplier-network/rfqs`, {
        headers: { 'X-CSRF-Token': adminSession.csrf },
        data: {
          shopId,
          title: `P5A Review RFQ ${stamp}`,
          supplierBusinessIds: [supplierBiz.id],
          items: [{ name: 'P5A OLED', quantity: 3, sku: 'P5A-OLED' }],
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
                unitPrice: 7000,
                availableQuantity: 20,
                quotedQuantity: 3
              }
            ],
            estimatedDeliveryDate: new Date(Date.now() + 5 * 86400000).toISOString()
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

      const expectedArrival = new Date(Date.now() + 3 * 86400000);
      const po = await admin.request.post(`${API}/api/v1/supplier-network/purchase-orders`, {
        headers: { 'X-CSRF-Token': adminSession.csrf },
        data: {
          rfqId: rfqData.publicId,
          issue: true,
          expectedDeliveryDate: expectedArrival.toISOString()
        }
      });
      expect(po.ok(), await po.text()).toBeTruthy();
      const poData = (await po.json()).data;

      const ack = await supplier.request.post(
        `${API}/api/v1/supplier-network/purchase-orders/${poData.publicId}/acknowledge`,
        {
          headers: { 'X-CSRF-Token': supplierSession.csrf },
          data: { expectedDeliveryDate: expectedArrival.toISOString() }
        }
      );
      expect(ack.ok(), await ack.text()).toBeTruthy();

      const ship = await supplier.request.post(`${API}/api/v1/supplier-network/shipments`, {
        headers: { 'X-CSRF-Token': supplierSession.csrf },
        data: {
          purchaseOrderId: poData.publicId,
          carrier: 'TCS',
          trackingNumber: `P5A-${stamp}`,
          expectedArrivalDate: expectedArrival.toISOString(),
          dispatch: true,
          lines: [{ poLineId: poData.lines[0].lineId, quantity: 3 }]
        }
      });
      expect(ship.ok(), await ship.text()).toBeTruthy();
      const shipData = (await ship.json()).data;

      const arrive = await supplier.request.patch(
        `${API}/api/v1/supplier-network/shipments/${shipData.publicId}`,
        {
          headers: { 'X-CSRF-Token': supplierSession.csrf },
          data: {
            status: 'delivered',
            actualArrivalDate: new Date(expectedArrival.getTime() - 86400000).toISOString()
          }
        }
      );
      expect(arrive.ok(), await arrive.text()).toBeTruthy();

      const grn = await admin.request.post(`${API}/api/v1/supplier-network/goods-receipts`, {
        headers: { 'X-CSRF-Token': adminSession.csrf },
        data: {
          purchaseOrderId: poData.publicId,
          idempotencyKey: `p5a-e2e-grn-${stamp}`,
          lines: [
            {
              poLineId: poData.lines[0].lineId,
              quantityAccepted: 3,
              quantityRejected: 0,
              quantityDamaged: 0
            }
          ]
        }
      });
      expect(grn.ok(), await grn.text()).toBeTruthy();

      // Shop admin UI: submit verified review
      await seedPageSession(admin.page, admin.request, adminSession.user);
      await openRoleHome(admin.page, 'shop_admin');
      await admin.page.goto(`/app/admin/suppliers/${supplierBiz.publicId || supplierBiz.id}`);
      await expect(admin.page.getByRole('heading', { name: new RegExp(`P5A Hub ${stamp}`) })).toBeVisible({
        timeout: 20000
      });
      await expect(admin.page.getByText(/Not enough data|n=0|No verified/i).first()).toBeVisible({
        timeout: 10000
      });
      await admin.page.getByRole('button', { name: /submit verified review/i }).click();
      await expect(admin.page.getByText(/success|کامیابی/i).first()).toBeVisible({ timeout: 20000 });

      // Duplicate rejected
      const dup = await admin.request.post(
        `${API}/api/v1/marketplace/suppliers/${supplierBiz.publicId || supplierBiz.id}/reviews`,
        {
          headers: { 'X-CSRF-Token': adminSession.csrf },
          data: {
            shopId,
            purchaseOrderId: poData.publicId,
            categoryRatings: stars,
            comment: 'duplicate'
          }
        }
      );
      expect(dup.status()).toBe(409);

      const listed = await admin.request.get(
        `${API}/api/v1/marketplace/suppliers/${supplierBiz.publicId || supplierBiz.id}/reviews`,
        { headers: { 'X-CSRF-Token': adminSession.csrf } }
      );
      expect(listed.ok()).toBeTruthy();
      const review = ((await listed.json()).data?.items || [])[0];
      expect(review).toBeTruthy();
      const reviewId = review.id;

      // Edit within window
      const edited = await admin.request.patch(
        `${API}/api/v1/marketplace/suppliers/reviews/${reviewId}`,
        {
          headers: { 'X-CSRF-Token': adminSession.csrf },
          data: {
            categoryRatings: { ...stars, overallExperience: 4 },
            comment: `Edited review ${stamp}`
          }
        }
      );
      expect(edited.ok(), await edited.text()).toBeTruthy();
      expect((await edited.json()).data.comment).toContain(String(stamp));

      // Supplier responds (UI)
      await seedPageSession(supplier.page, supplier.request, supplierSession.user);
      await openRoleHome(supplier.page, 'supplier');
      await supplier.page.goto('/app/supplier/performance');
      await expect(supplier.page.getByRole('heading', { name: /performance|کارکردگی/i })).toBeVisible({
        timeout: 15000
      });
      await expect(supplier.page.getByText(/Pending overdue/i)).toBeVisible({ timeout: 10000 });
      await expect(supplier.page.getByText(/Published reviews/i)).toBeVisible({ timeout: 10000 });
      const responseBox = supplier.page.locator('textarea').first();
      await expect(responseBox).toBeVisible({ timeout: 15000 });
      await responseBox.fill(`Thanks for the feedback ${stamp}`);
      await supplier.page.getByRole('button', { name: /post response/i }).click();
      await expect(
        supplier.page.getByText(new RegExp(`Thanks for the feedback ${stamp}|success|کامیابی`, 'i')).first()
      ).toBeVisible({ timeout: 20000 });

      // Unauthorized: supplier cannot create review
      const selfReview = await supplier.request.post(
        `${API}/api/v1/marketplace/suppliers/${supplierBiz.publicId || supplierBiz.id}/reviews`,
        {
          headers: { 'X-CSRF-Token': supplierSession.csrf },
          data: {
            shopId,
            purchaseOrderId: poData.publicId,
            categoryRatings: stars
          }
        }
      );
      expect([403, 409]).toContain(selfReview.status());

      // Unauthorized: supplier cannot access platform moderation
      await supplier.page.goto('/app/platform/supplier-reviews');
      await expect(supplier.page).not.toHaveURL(/platform\/supplier-reviews/, { timeout: 15000 });

      // Report reaches platform queue (Atlas demo may already hit 24h report cap)
      const report = await admin.request.post(
        `${API}/api/v1/marketplace/suppliers/reviews/${reviewId}/report`,
        {
          headers: { 'X-CSRF-Token': adminSession.csrf },
          data: {
            shopId,
            reason: 'Contains personal identifiers that need moderation review'
          }
        }
      );
      const reportText = await report.text();
      const reportRateLimited =
        report.status() === 429 || /REPORT_RATE_LIMIT/i.test(reportText);
      if (reportRateLimited) {
        test.info().annotations.push({
          type: 'environment',
          description:
            'REPORT_RATE_LIMIT on shared Atlas demo — report/moderation queue item not re-verified'
        });
      } else {
        expect(report.ok(), reportText).toBeTruthy();
        expect((JSON.parse(reportText) as { data: { status: string } }).data.status).toBe('reported');
      }

      await seedPageSession(ops.page, ops.request, opsSession.user);
      await openRoleHome(ops.page, 'platform_operator');
      await expect(ops.page.getByRole('heading', { name: /supplier reviews|سپلائر جائزے/i })).toBeVisible({
        timeout: 15000
      });
      if (!reportRateLimited) {
        await expect(ops.page.getByText(`Edited review ${stamp}`)).toBeVisible({
          timeout: 15000
        });
      }

      // Marketplace profile shows review + performance sample sizes (not fabricated high performer)
      await admin.page.goto(`/app/admin/suppliers/${supplierBiz.publicId || supplierBiz.id}`);
      await expect(admin.page.getByText(/Edited review|Thanks for the feedback/i).first()).toBeVisible({
        timeout: 20000
      });
      await expect(admin.page.getByText(/n=\d+/i).first()).toBeVisible({ timeout: 10000 });

      // Outsider customer cannot moderate
      const customerSession = await apiLogin(outsider.request, 'customer@repairconnect.local');
      const mod = await outsider.request.post(
        `${API}/api/v1/platform/supplier-reviews/${reviewId}/moderate`,
        {
          headers: { 'X-CSRF-Token': customerSession.csrf },
          data: { action: 'hide', reason: 'Customer should not moderate reviews' }
        }
      );
      expect(mod.status()).toBe(403);
    } finally {
      await ops.ctx.close();
      await admin.ctx.close();
      await supplier.ctx.close();
      await outsider.ctx.close();
    }
  });
});
