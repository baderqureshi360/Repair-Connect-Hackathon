# svelte-check inventory — Phase 1.2

Captured from working tree before cleanup fixes. Full raw log: `docs/svelte-check-phase12.txt`.

Error code for all entries below is TypeScript diagnostic via svelte-check (`(ts)` where noted). svelte-check does not always emit TS#### codes; messages are reproduced in full.

| # | File | Line:Col | Message |
|---|------|----------|---------|
| 1 | `client/src/hooks.client.ts` | 14:5 | Object literal may only specify known properties, and 'sendDefaultPii' does not exist in type 'CoreOptions&lt;BaseTransportOptions&gt; \| BrowserOptions \| NodeOptions'. |
| 2 | `client/src/hooks.server.ts` | 12:5 | Object literal may only specify known properties, and 'sendDefaultPii' does not exist in type 'CoreOptions&lt;BaseTransportOptions&gt; \| BrowserOptions \| NodeOptions'. |
| 3 | `client/src/lib/components/AppShell.svelte` | 140:44 | Type '"performance"' is not assignable to type 'NavKey'. (ts) |
| 4 | `client/src/lib/components/AppShell.svelte` | 149:49 | Type '"supplierReviews"' is not assignable to type 'NavKey'. (ts) |
| 5 | `client/src/routes/app/admin/purchase-orders/[id]/+page.svelte` | 97:22 | 'grn' is of type 'unknown'. (ts) |
| 6 | `client/src/routes/app/admin/rfqs/[id]/+page.svelte` | 85:52 | 'po' is of type 'unknown'. (ts) |
| 7–15+ | Multiple routes | various | Argument of type '"city"' \| '"address"' \| '"region"' is not assignable to parameter of type … (i18n `$t` MessageKey union) |
| 16 | `client/src/routes/app/repairs/[id]/+page.svelte` | 61:5 | Type 'unknown' is not assignable to type 'any[]'. (ts) |
| 17 | `client/src/routes/app/repairs/[id]/+page.svelte` | 276:7 | This expression is not callable. Type 'Writable&lt;string&gt;' has no call signatures. (ts) |
| 18 | `client/src/routes/app/supplier/catalog/+page.svelte` | 115:7 | Type 'string' is not assignable to type '"screens_displays"'. (ts) |
| 19–20 | `client/src/routes/login/+page.svelte` | 69:9, 72:11 | Comparison appears unintentional — `accountStatus` local type omitted `'pending_supplier'`. (ts) |

**Total before Phase 1.2 fixes: 29 errors in 20 files.**

## `"region"` investigation

- **Source:** `shop-registration/+page.svelte:208` and `supplier-registration/+page.svelte:216` — `$t('region')`.
- **Cause:** Missing dictionary keys `city` / `address` / `region` in `en.ts` / `ur.ts` (typed `$t` MessageKey).
- **Not** an icon name or component prop mismatch.
- **Pre-Porto:** Present at git `HEAD` (`859413f`) baseline check (10 errors included `$t('region')` on shop-registration).
- **Porto:** Did not introduce this call site.

## Classification vs `HEAD` (859413f)

| Metric | Count |
|--------|------:|
| HEAD baseline (`svelte-check`) | 10 |
| Pre-fix working tree | 29 |
| Delta (mostly untracked supplier/network + incomplete NavKey) | +19 |
| Porto design-token / Shop Admin UI introduced | **0** among CSS/token/admin page files |
| AppShell NavKey gaps (`performance`, `supplierReviews`) | 2 (in Porto-touched shell; keys already in i18n) |
