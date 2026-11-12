# Phase 6.1 — Accessibility & RTL Report

**Date:** 2026-11-10  
**Method:** Automated Playwright + axe-core. Manual NVDA/VoiceOver **not** run in this environment.

---

## Summary classification

| Area | Status |
|------|--------|
| Login axe + keyboard | **Verified** (automated) |
| Portal dashboards axe (customer/mechanic/parts/admin) | **Verified** (automated `portals.a11y.spec.ts`) |
| English / Urdu RTL (`dir=rtl`) | **Verified** (automated) |
| Viewport 360 / 390 / 768 / 1024 / desktop | **Verified** (automated theme suite) |
| Dark / light / reduced-motion emulation | **Verified** (Playwright `emulateMedia`) |
| Screen-reader semantics (landmarks, labels) | **Partially verified** (axe + roles; no NVDA) |
| Forms / dialogs / tables / reports | **Partially verified** (parts inventory table + analytics; not every dialog) |
| Real NVDA / VoiceOver | **Blocked / unverified** — not available on this host |

---

## Automated evidence

| Suite | Result |
|-------|--------|
| `tests/a11y.spec.ts` | Pass (login axe + keyboard Tab focus) |
| `tests/portals.a11y.spec.ts` | Pass (prior full Phase 6.1 run: portals included) |
| `tests/phase6.1-a11y-theme.spec.ts` | Pass after session bootstrap fix (theme + motion + viewports + Urdu) |

Commands:

```text
npx playwright test tests/a11y.spec.ts tests/portals.a11y.spec.ts
npx playwright test tests/phase6.1-a11y-theme.spec.ts
```

### What automated covers

- axe WCAG 2A/2AA (and portals also 2.2 AA tags) — critical/serious must be empty
- Keyboard Tab reaches focusable control on login
- Urdu language switch sets `html[dir=rtl]`
- Mobile nav affordances at 360/390
- `colorScheme: dark|light` and `reducedMotion: reduce`

### What automated does not cover

- Spoken output / focus order announced by NVDA or VoiceOver
- Full registration / every modal dialog / every report table
- Physical printer or OS print dialog UX

---

## Manual verification required before GO

1. NVDA (Windows) or VoiceOver (macOS): login → customer repairs → estimate approve dialog.
2. Urdu RTL: receipt/invoice print preview reading order.
3. High-contrast / Windows forced colors if targeting government/enterprise clients.

Until those are signed off, treat a11y as **partially verified**.

---

## Print verification (Chromium PDF — not CSS-only)

| Format | Status | Artifact |
|--------|--------|----------|
| A4 invoice/document | **Verified** | `client/test-results/phase6.1-print/document-a4.pdf` |
| 80mm thermal | **Verified** | `document-thermal80.pdf` |
| 58mm thermal | **Verified** | `document-thermal58.pdf` |
| Urdu RTL A4 | **Verified** | `document-a4-urdu-rtl.pdf` |
| Long bilingual customer name stress | **Verified** | Injected into heading before PDF |
| Purchasing analytics A4 + `.no-print` hidden | **Verified** | `purchasing-analytics-a4.pdf` |
| Physical printer / OS dialog | **Unverified** | Not run |
| GRN/PO print pages | **Partially verified** | 58mm option added; PDF path exercised via documents |

Command: `npx playwright test tests/phase6.1-print.spec.ts` → **2 passed**. PDFs asserted via `%PDF` header and non-trivial byte length from `page.pdf()` under `emulateMedia({ media: 'print' })`.
