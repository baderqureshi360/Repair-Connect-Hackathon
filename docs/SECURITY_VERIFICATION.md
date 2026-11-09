# RepairConnect — Security Verification

**Date:** 2026-11-08  
**Scope:** Public-launch hardening verification (cookie auth, CSRF, CSP, demo guards).  
**Deploy:** Not performed.

## Authentication model

| Item | Implementation |
|------|----------------|
| Access token | JWT in `rc_access` **HttpOnly** cookie |
| Refresh token | JWT in `rc_refresh` **HttpOnly** cookie |
| CSRF | Double-submit: `rc_csrf` (JS-readable) + `X-CSRF-Token` header |
| Cookie flags | `Secure` when `NODE_ENV=production` or `SameSite=None`; `SameSite` from `COOKIE_SAME_SITE` (default `lax`) |
| CORS | Credentialed; allowlist `CLIENT_URL` (+ optional `CLIENT_URL_ALT`) |
| Frontend storage | User profile cache only in `localStorage`; **no JWT** |
| Bearer | Accepted for Vitest / non-browser clients; **skips CSRF** |
| Token in JSON | Only when `NODE_ENV=test` (Vitest helpers) |

## Automated verification (executed)

| Check | Status | Evidence |
|-------|--------|----------|
| Cookie login sets HttpOnly access/refresh + CSRF | **PASS** | `server/src/tests/cookie-auth.test.ts` + live `Invoke-WebRequest` login |
| CSRF rejected without header | **PASS** | cookie-auth test → `403 CSRF_REJECTED` |
| Bearer without CSRF allowed | **PASS** | cookie-auth test |
| Refresh + logout | **PASS** | cookie-auth test |
| Full Vitest suite | **PASS** | 27/27 |
| Playwright portals | **PASS** | 8/8 |
| Production config guards incl. `ALLOW_DEMO_LOGIN` | **PASS** | `config.test.ts` |
| Atlas concurrency | **PASS** | `verify:atlas` → one `200`, one `409 INSUFFICIENT_STOCK` |
| Client bundle free of JWT secret / demo password | **PASS** | scan of `.svelte-kit/output/client` |

## Production guards (code)

| Guard | Behavior |
|-------|----------|
| Weak/missing `JWT_SECRET` | Fatal in production |
| `USE_MEMORY_DB=true` | Fatal in production |
| `SEED_ON_START=true` | Fatal in production |
| `ALLOW_DEMO_LOGIN=true` | Fatal in production |
| `seedDatabase()` / `npm run seed` | Throws in production |
| Demo emails (`*@repairconnect.local`) | Login blocked when `isProd` |

## CSP

| Surface | Policy | Verified |
|---------|--------|----------|
| API (Helmet, production) | Restrictive; Swagger mount local override | Code + prod build compile; **header on live HTTPS host pending** |
| SvelteKit (production build) | `kit.csp` mode `auto` — scripts `self`, fonts Google, style `unsafe-inline` for Tailwind | Production `vite build` succeeded; **browser CSP break test on HTTPS pending** |

## Manual / pending

| Check | Status |
|-------|--------|
| Inspect `Set-Cookie` on production HTTPS (`Secure`) | Pending (no deploy) |
| Production CSP functional smoke in browser | Pending (no deploy) |
| Rotate/disable demo passwords on Atlas before public URL | **Required** |
| Real NVDA | Pending — see `docs/NVDA_TEST_CHECKLIST.md` |

## Remaining production blockers

1. TLS deploy + confirm `Secure` cookies.
2. Disable or rotate demo seed accounts on Atlas before public exposure.
3. Confirm split-domain cookie strategy if API and app origins differ.
4. Complete NVDA checklist with an actual screen reader.
