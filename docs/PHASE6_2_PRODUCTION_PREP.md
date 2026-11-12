# RepairConnect — Phase 6.2: Final Production Deployment Preparation

**Date:** 2026-11-10  
**Scope:** Operational preparation only (no feature work, no schema/API/business-logic changes).  
**Live production deploy:** **Not performed.**  
**Decision:** **NO-GO** until HTTPS host sign-off, Atlas backup confirmation, demo purge approval + execution, and Sentry smoke with a real DSN.

---

## 1. HTTPS and secure cookies

| Item | Status | Evidence |
|------|--------|----------|
| `COOKIE_SECURE` resolution | **Code verified** | `server/src/config/env.ts` — `true` when set / prod / SameSite=none; `false` fatal in prod |
| Cookie `Secure` flag wiring | **Code verified** | `server/src/utils/cookies.ts` uses `env.cookieSecure` |
| Default `COOKIE_SAME_SITE=lax` | **Code verified** | env default; CSRF double-submit unchanged |
| Refresh rotation + logout | **Code verified** (Phase 6.1) | RefreshSession hash + rotation + reuse detection; logout revokes family |
| CORS allowlist + credentials | **Code verified** | `CLIENT_URL` (+ alt); credentials true |
| `trust proxy = 1` | **Code verified** | `server/src/app.ts` |
| Production `CLIENT_URL` must be `https://` | **Code verified** | Fatal unless localhost staging |
| Live HTTPS cookie check | **Unverified** | Requires real TLS host — do not claim Pass without DevTools on HTTPS |

Domain/TLS checklist: `DEPLOYMENT.md` §8. Manual HTTPS rows: `docs/MANUAL_ACCEPTANCE_CHECKLIST.md` §C.

---

## 2. MongoDB Atlas backup

| Item | Status |
|------|--------|
| App-level backup/restore docs | **Updated** — `docs/BACKUP_RESTORE.md` (PITR, RPO/RTO, restore steps) |
| Isolated probe DB | **Available** — `npm run probe:backup-restore -w server` (`repairconnect_p6_backup_probe`) |
| Continuous Backup / PITR on Atlas org | **Unverified** — ops must confirm in Atlas UI |
| Latest successful snapshot | **Unverified** — record timestamp in go-live ticket |
| Destructive restore of production | **Not performed** (forbidden without maintenance window) |

Targets documented: RPO ≤ 1h (PITR) or ≤ 24h (daily); RTO ≤ 4h.

---

## 3. Demo account cleanup

| Item | Status |
|------|--------|
| Inventory script | **Ran** — `npm run demo:list -w server` (read-only) |
| Deletion plan | **Documented** — `docs/DEMO_ACCOUNT_CLEANUP_PLAN.md` |
| Deletion executed | **No** — awaiting explicit approval |
| Secret rotation checklist | **Documented** in cleanup plan |

### Inventory summary (2026-11-10)

- **8** `@repairconnect.local` users (seed + test + `p4.e2e.ops`)
- **2** demo shops (`LHR01`, `KHI01`)
- Dependencies: memberships 11, repairs 43, parts 7, appointments 1

After approval only:

```bash
npm run demo:cleanup -w server
CLEANUP_CONFIRM=DELETE_DEMO_ACCOUNTS npm run demo:cleanup -w server -- --execute
```

---

## 4. Error monitoring (Sentry)

| Item | Status |
|------|--------|
| Provider | **Sentry** (`@sentry/node`, `@sentry/sveltekit`) |
| Server init + Express bridge | **Configured** — `server/src/observability/sentry.ts`; started from `index.ts` |
| Client + SvelteKit hooks | **Configured** — `client/src/hooks.client.ts`, `hooks.server.ts` |
| DSN via env only | **Yes** — `SENTRY_DSN` / `PUBLIC_SENTRY_DSN` (templates in `.env.production.example`) |
| PII scrub (cookies/auth headers) | **beforeSend** strips cookie/authorization/csrf headers |
| Intentional smoke event | **Blocked** — `npm run monitor:smoke -w server` → `SENTRY_DSN is not configured` |

Ops: set DSN in host secrets, then:

```bash
SENTRY_DSN=https://…@o….ingest.sentry.io/… npm run monitor:smoke -w server
```

Confirm the event in the Sentry project UI before GO.

---

## 5. Production deployment configuration

| Artifact | Path |
|----------|------|
| API prod template | `.env.production.example` |
| Client prod template | `client/.env.production.example` |
| Root env docs | `.env.example` (COOKIE_SECURE + Sentry notes) |
| Deploy / rollback / TLS | `DEPLOYMENT.md` |
| Backup / restore | `docs/BACKUP_RESTORE.md` |
| Vercel front-only plan | `docs/VERCEL_DEPLOYMENT_PLAN.md` |

### Build & start

```bash
npm install
npm run build -w server
npm run build -w client
NODE_ENV=production npm run start -w server
# client: node client/build/index.js  (adapter-node) or Vercel per plan
```

### Probes & shutdown

- `GET /health` — liveness + `dbMode`
- `GET /ready` — readiness (DB connected)
- `SIGTERM` / `SIGINT` — graceful HTTP close + Mongo disconnect (15s force)

No production credentials committed.

---

## 6. Manual acceptance

| Doc | Purpose |
|-----|---------|
| `docs/MANUAL_ACCEPTANCE_CHECKLIST.md` | NVDA login/dashboard, keyboard-only, HTTPS cookies, print |
| `docs/NVDA_TEST_CHECKLIST.md` | Full NVDA matrix + keyboard companion rows |

Automated axe/Playwright ≠ NVDA sign-off.

---

## Pre-GO gate (unchanged NO-GO)

1. Staging/production HTTPS with Secure cookies confirmed in browser.
2. Atlas Cloud Backup / PITR confirmed; latest snapshot recorded.
3. Explicit approval → demo purge + credential/secret rotation.
4. `SENTRY_DSN` set; `monitor:smoke` event visible in Sentry.
5. Manual NVDA + keyboard checklist signed.
6. Regression smoke on staging (`npm test -w server` + e2e smoke).

**Until then: NO-GO for public production traffic.**
