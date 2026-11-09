# RepairConnect — UX & Analytics Acceptance Report

**Date:** 2026-11-08  
**Scope:** Print preview, RTL/Urdu, dark-independent print, charts vs tables, account-switch cache, customer financial terminology, regression gates  
**Constraint:** No new product features / redesign; terminology + print CSS hardening only

---

## Verdict

Acceptance checks for print preview, analytics terminology, chart/table parity, account-switch cache, and CSV scoping **passed when executed**. Payment/invoice history remains snapshot-based (unchanged). Physical printers and screen readers were **not** tested.

---

## Automated results (executed)

| Gate | Result |
|------|--------|
| Backend Vitest | **41/41** |
| Playwright (full suite, 12 tests) | **12/12** |
| — prior smoke/a11y (8) | Included |
| — new UX acceptance (4) | Included (`client/tests/ux-acceptance.spec.ts`) |
| Server production build | **Passed** |
| Client production build | **Passed** |
| Atlas verify | **`ATLAS_VERIFY_PASSED`** |

### UX acceptance suite coverage

1. **Print formats + Urdu RTL + dark-independent CSS** — A4 / 80mm / 58mm under `emulateMedia({ media: 'print', colorScheme: 'dark' })`; `dir=rtl` `lang=ur`; black-on-white computed styles; thermal width bounds; no horizontal clip on 58mm; screenshots saved under `client/test-results/ux-print/`.
2. **Charts vs tables** — each Chart.js series shares the same `points[]` as its accessible data table; customer financial summary widgets visible for 90d range.
3. **Account switch** — Customer A → logout clears `rc_prefs`/`rc_theme` → Customer B; refresh + back/forward; `/auth/me` remains B.
4. **CSV scoping** — admin `operations.csv` 200; mechanic 403.

---

## Manual / browser-assisted checks (executed via Playwright print media + screenshot review)

| Check | Result |
|-------|--------|
| A4 print preview | **Pass** — white sheet, black text; Urdu header/footer RTL |
| 80mm / 58mm preview | **Pass** — narrowed article width; track URL wraps without clip |
| Urdu RTL alignment | **Pass** — `dir=rtl`; Urdu strings right-aligned |
| Dark-theme-independent print | **Pass** — print CSS forces `#000` / `#fff` with dark `html` class + dark color scheme |
| Margins / page-break CSS | **Pass** (CSS present: `@page` 12mm, avoid break inside rows/images) |
| Invoice line clipping | **Pass** on sampled intake/invoice docs in thermal58 |
| Chart ↔ table values | **Pass** — same data source bound to both canvas and table |
| Dashboard stats + CSV scope | **Pass** (API + UI session tests) |

Screenshots reviewed: `print-a4-ur-dark.png`, `print-thermal80-ur-dark.png`, `print-thermal58-ur-dark.png`.

---

## Code changes for analytics terminology (item 8)

Customer analytics now exposes:

| Field | Source |
|-------|--------|
| `completedRepairValue` | Sum of completed repair `finalCost` in range |
| `actualCustomerSpending` | Sum of confirmed `PaymentRecord.amount` in range |
| `outstandingBalance` | Σ max(0, finalCost − payments) across completed repairs (supports partial pay) |
| `recordedSpending` | Alias of `completedRepairValue` (compat) |

Charts: `monthlyCompletedRepairValue`, `monthlyActualSpending` (replaces single ambiguous `monthlySpending`).  
UI: summary cards on `DashboardAnalytics`.  
History: document snapshots / payment records are not rewritten by analytics.

Print CSS: margins, thermal max-widths in `@media print`, overflow wrap, break-inside avoid for rows/images.

---

## Remaining limitations (not claimed as passed)

| Item | Status |
|------|--------|
| **Physical printer** output | **Not performed** |
| **NVDA / real screen reader** | **Not performed** |
| **QR on print sheet** | **Absent** — print shows `/track/...` text only; QR image exists on repair detail page, not document print |
| **RTL phone digit display** | Phone may visually reorder under `dir=rtl` (e.g. trailing `+`) — cosmetic |
| **A4 RTL whitespace** | Content packs to the inline-start (right) side under RTL; full-bleed A4 centering not redesigned |
| **Auth rate limit** | Local login limiter (30 / 15m) can trip dense Playwright runs; restart clears in-memory store |

---

## Production blockers

**None** from this acceptance pass.
