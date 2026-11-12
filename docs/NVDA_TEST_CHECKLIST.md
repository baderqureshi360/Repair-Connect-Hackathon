# RepairConnect — NVDA Test Checklist (Windows)

**Screen reader:** NVDA (latest stable)  
**Browser:** Firefox or Chrome  
**Date started:** 2026-11-08  

## How to run

1. Start API + client against Atlas (or memory) with demo seed available in **development only**.
2. Start NVDA; enable speech viewer (NVDA+N → Tools → Speech viewer) for evidence notes.
3. Use browse mode / focus mode as NVDA directs; tab through interactive controls.
4. Record **Pass / Fail / Blocked** per row. Do **not** mark Pass without hearing NVDA announce the expected name/role/state.

## Results legend

| Symbol | Meaning |
|--------|---------|
| Pass | Verified with NVDA speech |
| Fail | Incorrect/missing announcement or focus trap |
| Pending | Not yet executed with a real screen reader |
| N/A | Flow not available in current data |

---

## Session results

**Tester:** _(name)_  
**NVDA version:** _(fill)_  
**Browser:** _(fill)_  
**Environment:** local / staging  
**Overall:** **Pending — real NVDA session not completed in this hardening pass**

Axe-core + keyboard Playwright coverage exists; that is **not** a substitute for this checklist.

| # | Flow | Expected | Result | Notes |
|---|------|----------|--------|-------|
| 1 | Login page load | Page title + heading announced | Pending | |
| 2 | Login fields | Email/password labels announced; errors via `role=alert` | Pending | |
| 3 | Registration | Name/email/password + hint linked | Pending | |
| 4 | Customer repair submit | Labels, required fields, submit busy state | Pending | |
| 5 | Repair tracking (auth + public `/track/:token`) | Status and history readable | Pending | |
| 6 | Estimate approval | Approve/reject controls named; dialog focus | Pending | |
| 7 | Mechanic job management | Job list, detail actions, status updates | Pending | |
| 8 | Parts request processing | Table headers, row actions, stock feedback | Pending | |
| 9 | Shop administration | Staff list, create staff form | Pending | |
| 10 | Dialogs / dropdowns | Focus moves into dialog; Escape closes; selects announce | Pending | Account menu, modals |
| 11 | Form validation | Invalid fields + live error text | Pending | |
| 12 | Notifications / dynamic status | `aria-live` region announces toasts/unread | Pending | |
| 13 | Mobile header (360/390) | Menu button, notifications, account menu, lang/theme in menu | Pending | |
| 14 | Skip link | “Skip to content” lands in `#main` | Pending | |

## Defects found

| ID | Severity | Description | Fix status |
|----|----------|-------------|------------|
| — | — | None logged yet (NVDA not run) | — |

## Keyboard-only (companion to NVDA)

No mouse. Tab / Shift+Tab / Enter / Space / Escape.

| # | Step | Expected | Result | Notes |
|---|------|----------|--------|-------|
| K1 | Login form | Focus order email → password → Sign in; Enter submits | Pending | |
| K2 | Skip link | Lands in `#main` | Pending | |
| K3 | Customer repair open/back | Focus remains sensible; no trap | Pending | |
| K4 | Estimate approve/reject | Controls reachable and activatable | Pending | |
| K5 | Admin staff dialogs | Escape closes; focus returns | Pending | |
| K6 | Focus visibility | Outline/ring visible every stop | Pending | |
| K7 | Mobile nav (360px) | Menu open/close fully keyboard operable | Pending | |

Full acceptance form: `docs/MANUAL_ACCEPTANCE_CHECKLIST.md`.

## Related automated coverage (not NVDA)

- Playwright axe + keyboard: `client/tests/a11y.spec.ts`, `portals.a11y.spec.ts`
- Login/register label + `role=alert` improvements applied during hardening
