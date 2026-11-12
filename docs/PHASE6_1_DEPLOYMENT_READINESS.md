# Phase 6.1 — Deployment Readiness

**Date:** 2026-11-10  
**Live production deploy:** **Not performed** (no authorization).

---

## Decision: **NO-GO**

Ship blockers remain outside application code: HTTPS host, Atlas backup operational sign-off, demo-account purge, and monitoring destination.

---

## Checklist

| Item | Classification | Evidence / notes |
|------|----------------|------------------|
| Production env validation (`JWT_SECRET`, no memory DB, no seed/demo) | **Verified** (code) | `server/src/config/env.ts` fatal guards |
| `.env.example` documents required vars | **Verified** | Updated historically; no secrets committed |
| HTTPS + Secure cookies | **Partially verified** | `Secure` when `isProd` or `SameSite=none`; **live HTTPS host unverified** |
| CORS allowlist + `trust proxy` | **Verified** (code) | `createApp()` CORS + `trust proxy = 1` |
| Frontend/API URL split (Vercel vs API host) | **Partially verified** | Plan in `VERCEL_DEPLOYMENT_PLAN.md`; not live |
| MongoDB Atlas config | **Verified** (local Atlas URI) | `env:check` + app connections |
| `GET /health` | **Verified** | Vitest + live probe |
| `GET /ready` | **Verified** | Phase 6 readiness tests |
| Logging (morgan combined in prod, no auth headers) | **Verified** (code) | |
| Error monitoring (Sentry/etc.) | **Partial (Phase 6.2)** | Wired via env; smoke blocked until `SENTRY_DSN` set — see `PHASE6_2_PRODUCTION_PREP.md` |
| Backup procedure documented | **Verified** | `docs/BACKUP_RESTORE.md` |
| Isolated backup/restore probe | **Verified** | Phase 6 `probe:backup-restore` on `repairconnect_p6_backup_probe` |
| Atlas Continuous Backup enabled | **Unverified** | Ops action in Atlas UI |
| Graceful shutdown | **Verified** (code) | SIGTERM/SIGINT in `index.ts` |
| Server `tsc` build | **Verified** | Pass in Phase 6 |
| Client production build | **Verified** | Pass in Phase 6 |
| Full Vitest regression | **Verified** | **27 files / 138 tests** after refresh-session work |
| Refresh session revocation in prod path | **Verified** | See security report |
| Demo accounts absent from prod Atlas | **Unverified** | Must confirm before cutover |
| Secrets in source control | **Verified** none | |

---

## Production env (reference — do not commit values)

```bash
NODE_ENV=production
MONGODB_URI=mongodb+srv://...
USE_MEMORY_DB=false
JWT_SECRET=<≥32 chars>
CLIENT_URL=https://<frontend-origin>
# COOKIE_SAME_SITE=none   # only if API and web are different sites
PORT=5000
# SEED_ON_START must be unset/false
# ALLOW_DEMO_LOGIN must be unset/false
```

Frontend build:

```bash
VITE_API_URL=https://<api-host>   # when not same-origin proxied
npm run build -w client
```

---

## Pre-GO gate

1. Deploy API + web behind HTTPS with confirmed Secure cookies (browser DevTools).
2. Enable Atlas Cloud Backup; restore drill signed off.
3. Delete/rotate all `@repairconnect.local` users on production DB.
4. Point error monitoring (or accept risk explicitly).
5. Re-run `npm test -w server` and Playwright smoke against staging.

**Until then: NO-GO.**
