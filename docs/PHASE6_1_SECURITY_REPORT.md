# Phase 6.1 — Security Report

**Date:** 2026-11-10  
**Scope:** Refresh-token revocation, multi-tenant isolation, auth hardening.  
**Deploy authorization:** Not requested — no production deploy performed.

---

## GO / NO-GO

**NO-GO for production cutover.**

Refresh-token revocation is implemented and covered by automated tests. Multi-tenant ACL remains strong at the API layer. Production cutover still requires a live HTTPS host, Atlas backup sign-off, and removal/rotation of demo accounts.

---

## 1. Refresh-token revocation

| Item | Classification | Evidence |
|------|----------------|----------|
| Server-side refresh session registry (`RefreshSession`) | **Verified** | Model stores `tokenHash` (SHA-256), `sid`, `familyId`; never plaintext JWT |
| Login/register creates hashed session | **Verified** | `createRefreshSession` + Vitest `stores only hashed refresh tokens` |
| Rotation on `/auth/refresh` | **Verified** | Atomic claim + new session; prior token replay → 401 |
| Reuse detection (replay after rotate) | **Verified** | Family revoke on reused rotated token (`TOKEN_REUSE` / 401) |
| Concurrent refresh safety | **Verified** | Exactly one successor; loser 401 without wiping winner |
| Logout revokes session | **Verified** | `revokeRefreshSessionByToken(..., 'logout')` |
| Password change revokes all + re-issues caller | **Verified** | Vitest password-change case |
| Password reset consume + revoke all | **Verified** | `POST /auth/reset-password` + Vitest |
| Staff deactivate / password reset revoke | **Verified** | Wired in `staff.ts` |
| Supplier suspend revokes owner sessions | **Verified** | Wired in `suspendSupplierBusiness` |
| HttpOnly cookies + CSRF preserved | **Verified** | Existing `cookie-auth.test.ts` still green |
| Access-token immediate kill on logout | **Partially verified** | Refresh revoked; short-lived access JWT may remain until TTL (by design) |

### Architecture notes

- Refresh JWT claims: `typ=refresh`, `sid`, `fid`.
- Storage: SHA-256 of full refresh JWT only.
- TTL index on `expiresAt` for cleanup.
- Legacy `signRefreshToken()` without registry is deprecated and unused by routes.

### Automated regression

```text
npm test -w server
  → 27 files / 138 tests passed (includes refresh-session-revocation + cookie-auth)

Focused: src/tests/refresh-session-revocation.test.ts → 7/7 passed
```

---

## 2. Multi-tenant isolation

| Actor / check | Classification | Evidence |
|---------------|----------------|----------|
| Customer ↔ customer repairs (API) | **Verified** | `isolation.test.ts` + Phase 6.1 Playwright API cookie checks |
| Mechanic unassigned / foreign id | **Verified** | Isolation suite + Playwright 403/404 on forged id |
| Parts ↔ other shop inventory | **Verified** | Isolation + Playwright forged `shopId` → 403/400/404 |
| Shop admin ↔ other shop | **Verified** | Isolation + analytics/reports forged shop |
| Supplier ↔ other supplier / shop analytics | **Partially verified** | API gates in Phase 5B/5A; demo supplier often absent (skipped in E2E) |
| Platform operator scope | **Partially verified** | Existing platform route tests; operator not always seeded for E2E |
| UI portal routing (role home) | **Verified** | Playwright portals + tenant UI redirects |
| Two independent shops | **Verified** (API) | `isolation.test.ts` seeds Shop A/B |

Browser E2E notes: Playwright tenant suite exercises UI + cookie API. Some environments hit auth rate limits when reusing a long-lived API without `DISABLE_AUTH_RATE_LIMIT=1` — config updated for Playwright-started servers.

---

## 3. Other hardening this phase

| Item | Classification | Notes |
|------|----------------|-------|
| Login form `method="post"` | **Verified** | Defense against accidental credential GET |
| Demo login blocked in production | **Verified** | Existing `assertDemoLoginAllowed` |
| Secrets not in source | **Verified** | `.env.example` placeholders only |

---

## Residual risks

1. Access JWTs are not denylisted (short TTL mitigates).
2. No external IdP / device binding.
3. Demo `@repairconnect.local` accounts must not exist in production Atlas.
4. Live HTTPS + Secure cookie confirmation still outstanding (see deployment report).
