# RepairConnect — Advanced SaaS Expansion Plan

**Date:** 2026-11-08  
**Basis:** Full monorepo audit (existing cookie auth, 19 models, 4 portals, no charts/PDF/finance models).

## Assumptions

1. Enhance in place — no architecture rewrite; keep Express + SvelteKit + Atlas + cookie JWT/CSRF.
2. Charts: add lightweight `layerchart` or Chart.js via `chart.js` + thin Svelte wrapper (no heavy React libs). Prefer **Chart.js** for maturity + a11y text tables alongside.
3. PDF: server or client print-to-PDF via `@media print` + browser print first; optional `pdfkit` on server later if needed. Prefer **print CSS + window.print + Save as PDF** before adding heavy PDF deps.
4. Payments: **record-only** (no payment gateway).
5. Theme/appearance stored on User (or UserPreferences subdoc) — not shared via localStorage alone.
6. Mechanic detail access becomes **assignment-scoped**; shop admin/parts retain shop scope with field redaction for internal notes where needed.

## Existing reuse

- Auth cookies/CSRF, `assertShopAccess`, repair ownership filters, StatGrid/DataTable/AppShell, admin reports aggregate, receipt JSON endpoint, notification prefs, language on User.

## Gaps (do not duplicate)

| Gap | Action |
|-----|--------|
| Mechanic GET repair shop-wide | Assignment + field policy |
| Mechanic stats shop-wide | Filter `assignedMechanic` |
| No profile page | Add `/app/profile` + APIs |
| Theme local-only | Persist on User preferences |
| No charts | Add Chart.js + analytics APIs |
| TXT receipt only | Document module + print layouts |
| No payments/docs | PaymentRecord + FinancialDocument + sequences |
| No isolation suite | New Vitest multi-user IDOR tests |

## Priority order (vertical slices)

### P1 — Isolation & profile (NOW)
- Central `access` helpers for repair/appointment/document
- Harden GET/stats/receipt/search/aggregations
- Strip internal notes from customer/public payloads
- Profile + change-password; forbid self role/shop edits
- Isolation Vitest (Customer A/B, Mechanic A/B, Admin A/B, Parts A/B)

### P2 — Analytics
- `/api/v1/analytics/{role}` scoped aggregations + date range
- Chart component + dashboard upgrades + CSV + accessible tables

### P3 — Appearance
- User.preferences (theme, accent, density, fontScale, reducedMotion, highContrast, widgets, sidebarCollapsed)
- Appearance page; hydrate on login; clear cache on logout/account switch

### P4 — Documents & printing
- ShopSettings / DocumentSequence / FinancialDocument / PaymentRecord
- Issue intake/job card/estimate/invoice/payment/warranty/handover
- A4 / 80mm / 58mm print routes + `@media print`

### P5 — Ops realism
- DeviceIntake fields or record; work log; estimate revision re-approval; payment recording UI

### P6 — Regression
- Existing 27+8 tests; new isolation/analytics/print tests; Atlas verify; responsive; docs/report

## Out of scope

- Payment gateway, SMS/email providers, redesign from scratch, weakening CSRF/cookies.
