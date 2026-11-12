# RepairConnect — Phase 6 Production Readiness Audit

**Date:** 2026-11-10  
**Scope:** Evidence-based audit and controlled stabilization (no feature rewrite).  
**Deployment claim:** **Not production-deployed.** Local builds and isolated Atlas probe only. See `docs/VERCEL_DEPLOYMENT_PLAN.md`.

---

## Executive verdict

| Area | Result | Notes |
|------|--------|-------|
| Financial integrity | **Defects found & fixed** | Credit notes misclassified as cash; AP double-count; reversal balance math |
| Security / multi-tenant | **Pass (existing coverage + new IDOR cases)** | Shop membership + role gates; CSRF + HttpOnly cookies |
| Database reliability | **Pass (isolated)** | Indexes inspected; backup/restore on `repairconnect_p6_backup_probe` |
| Production deployment | **Not complete** | Builds OK; no live production deploy performed |
| Automated Vitest | **PASS** | **26 files / 131 tests** after lock-timeout hardening |
| Accessibility / print | **Partial + smoke** | Playwright `a11y.spec.ts` 2/2 passed (login axe + keyboard); full RTL/print matrix still follow-up |

---

## Confirmed defects fixed

### 1. Credit notes counted as cash payments (analytics)

**Evidence:** `supplierPurchasingAnalytics` aggregated `kind ∈ [payment, credit_note]` into `paidValue` / expenditure.

**Fix:** Split KPIs: `cashPaymentsInPeriod` / `paidValueInPeriod` (payments only) and `creditNotesInPeriod`. UI labels updated (EN/UR). API `POST /ledger/credit-notes` added so credit notes can be posted through the same auth path as payments.

**Regression:** `server/src/tests/supplier-network-phase6-finance.test.ts`.

### 2. Outstanding payable double-counted PO + GRN

**Evidence:** Issue posts `po_obligation` and GRN posts `goods_received` for the same value; balance summed both → AP ≈ 2× received.

**Fix:** `getSupplierBalance` / `outstandingPayablesReport` treat `po_obligation` as commitment memo only; AP kinds = goods_received, invoices, payments, credit notes, adjustments, reversals.

### 3. Payment reversal inflated outstanding

**Evidence:** Original marked `status=reversed` (dropped from posted-only sum) **and** opposite `reversal` row posted → undo applied twice.

**Fix:** Outstanding sums include both `posted` and `reversed` rows so original + reversal net to zero. Cash KPI still uses `status=posted` only (reversed payments leave `paidValue`).

### 4. No readiness / graceful shutdown

**Fix:** `GET /ready` (503 if DB disconnected); SIGTERM/SIGINT graceful HTTP + DB disconnect in `index.ts`.

### 5. Parallel Vitest lock flake on shop registration

**Evidence:** Full suite failure: `Unable to acquire IX lock … within 5ms` under mongodb-memory-server load.

**Fix:** Shop owner register uses `withMongoTransaction` (retries); lock timeouts treated as transient; Vitest `maxWorkers: 4`.

---

## Security & multi-tenant (evidence)

| Control | Evidence |
|---------|----------|
| Role gates | Phase 3–5B + Phase 6 IDOR tests (cross-shop ledger payment/credit-note → 403) |
| Shop ownership server-side | `assertShopAccess` / `assertShopReceivingAccess` require `user.shopIds` |
| Supplier scope | `requireApprovedSupplierBusiness(ownerId)` — not client-supplied ownership |
| Cookies | HttpOnly access/refresh; CSRF double-submit; Secure in prod / SameSite=none (`cookie-auth.test.ts`) |
| Bearer JWT in body | Emitted only when `NODE_ENV=test` |
| Demo logins | Forbidden in production (`assertDemoLoginAllowed`) |
| Prod env guards | `JWT_SECRET` ≥32, no memory DB, no seed/demo (`env.ts`) |
| CORS | Allowlist `CLIENT_URL` (+ optional alt); credentials true |
| Rate limit | Auth + write limiters; skipped for `/health` and `/ready` |
| Helmet CSP | Enabled in production |

**Residual (not changed — auth architecture):** Refresh tokens are JWT cookies without server-side revocation store; logout clears cookies only. Documented risk for stolen refresh until TTL expiry.

---

## Database reliability (evidence)

| Check | Result |
|-------|--------|
| Supplier review indexes (Atlas) | `one_review_per_po` unique present; legacy shop+supplier unique absent (`inspectSupplierReviewIndexes`) |
| Ledger idempotency | Unique partial index `shop + idempotencyKey`; Phase 6 concurrent test → count 1 |
| Transactions | `withMongoTransaction` required for payments/GRNs/reversals |
| Backup/restore | `npm run probe:backup-restore` → **PASS** on isolated DB `repairconnect_p6_backup_probe` (`productionDbTouched: false`) |
| Operational Atlas snapshots | Still required in Atlas UI/ops — probe does not replace Continuous Backup |

---

## Production deployment audit

| Item | Status |
|------|--------|
| `server` `tsc` build | Pass |
| `client` `vite build` | Pass (SSR + client) |
| `env:check` | Pass (Atlas URI configured locally) |
| `/health` + `/ready` | Covered by Vitest |
| Secure cookies / CORS / trust proxy | Code present (`trust proxy` = 1) |
| Vercel frontend | Plan only — **not live-deployed** (Windows EPERM / login pending) |
| API host | Must be persistent Node (not Vercel serverless) |
| Secrets in repo | `.env` gitignored; `.env.example` has placeholders only |

**Do not claim production deployment complete.**

---

## Financial reconciliation rules (post-fix)

- **Ordered value:** non-cancelled PO `grandTotal` (issuedAt in range)
- **Received value:** posted GRN `totalAcceptedValue`
- **Cash paid (period):** posted `payment` abs amounts only
- **Credit notes (period):** posted `credit_note` abs amounts — never cash
- **Outstanding AP:** Σ AP kinds including reversed+reversal pairs; **exclude** `po_obligation`

---

## Automated verification log

Commands executed this phase:

```text
npm test -- src/tests/supplier-network-phase6-finance.test.ts src/tests/phase6-readiness.test.ts
  → 6 passed

npm run probe:backup-restore
  → PASS isolated DB repairconnect_p6_backup_probe

npm run build -w server   → tsc OK
npm run env:check -w server → OK
npm run build -w client   → vite build OK
npx tsx src/scripts/inspectSupplierReviewIndexes.ts → indexes OK

npm test -w server        → 26 files, 131 tests passed (~261s)
npm run test:a11y -w client → 2 passed (login axe + keyboard focus)
```

---

## Accessibility / UI (honest scope)

- Purchasing analytics: separate cash vs credit-note KPIs; EN + UR strings.
- Document/GRN print routes and CSS for A4 / 80mm / 58mm exist in codebase.
- Full keyboard / screen-reader / RTL / reduced-motion / live print-output matrix was **not** fully re-executed in this audit pass; treat as follow-up before launch.

---

## Follow-ups before go-live

1. Live API + frontend deploy on HTTPS with `COOKIE_SAME_SITE=none` if cross-site.
2. Enable Atlas Continuous Backup / PITR; schedule restore drill beyond the probe DB.
3. Optional: server-side refresh-token revocation.
4. Playwright a11y + print smoke across roles and two shops.
5. Supplier finance UI affordance for credit notes (API ready).
