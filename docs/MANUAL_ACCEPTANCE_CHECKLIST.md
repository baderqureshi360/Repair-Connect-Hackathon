# RepairConnect — Manual Acceptance Checklist (Phase 6.2)

Complete on **staging HTTPS** (preferred) or a controlled local build. Automated axe/Playwright is complementary, not a substitute for NVDA or keyboard sign-off.

**Environment URL:** _______________  
**Tester:** _______________  
**Date:** _______________  
**Build / commit:** _______________

---

## A. Keyboard-only navigation

Use Tab / Shift+Tab / Enter / Space / Escape only (no mouse).

| # | Step | Pass / Fail | Notes |
|---|------|-------------|-------|
| K1 | Login: Tab to email, password, Sign in; submit with Enter | | |
| K2 | Skip link “Skip to content” moves focus to `#main` | | |
| K3 | Customer: open repairs list; open a repair; return via Back | | |
| K4 | Estimate approve/reject controls reachable and activatable | | |
| K5 | Admin: open Staff; open create form; Escape closes dialogs/menus | | |
| K6 | Focus visible at every stop (outline/ring not removed) | | |
| K7 | Mobile 360px: open nav button, traverse links, close | | |

---

## B. NVDA (Windows) — login and dashboards

Prerequisites: NVDA latest stable; Firefox or Chrome; Speech Viewer on.

| # | Flow | Expected announcement | Pass / Fail | Notes |
|---|------|----------------------|-------------|-------|
| N1 | Load `/login` | Page title + Sign in heading | | |
| N2 | Email / password fields | Correct labels; errors via alert | | |
| N3 | Customer dashboard after login | Main landmark + key actions | | |
| N4 | Mechanic dashboard | Job list semantics | | |
| N5 | Parts inventory table | Column headers + row actions | | |
| N6 | Admin dashboard / staff | Headings + table/list structure | | |
| N7 | Language → Urdu | `dir=rtl` and controls still named | | |
| N8 | Notifications | Live region / unread count | | |

Full NVDA matrix: `docs/NVDA_TEST_CHECKLIST.md` (mark Session results there too).

---

## C. HTTPS / cookies (staging)

| # | Check | Pass / Fail | Notes |
|---|-------|-------------|-------|
| H1 | Site loads over `https://` with valid cert | | |
| H2 | DevTools → Cookies: `rc_access` / `rc_refresh` **HttpOnly** + **Secure** | | |
| H3 | `rc_csrf` readable by JS; mutating request without header → 403 CSRF | | |
| H4 | Logout clears cookies; refresh afterward fails | | |
| H5 | `/health` and `/ready` return success over HTTPS | | |

**Do not mark Pass for H\* on plain HTTP.**

---

## D. Print smoke (manual)

| # | Check | Pass / Fail | Notes |
|---|-------|-------------|-------|
| P1 | Document A4 print preview | | |
| P2 | 80mm / 58mm formats | | |
| P3 | Urdu RTL print | | |

Automated PDF evidence (Phase 6.1): `client/test-results/phase6.1-print/`.

---

## Sign-off

| Role | Name | Date | Decision |
|------|------|------|----------|
| Product / QA | | | Accept / Reject |
| Engineering | | | Accept / Reject |
