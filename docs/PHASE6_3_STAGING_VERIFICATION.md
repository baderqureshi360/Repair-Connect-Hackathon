# RepairConnect — Phase 6.3: Staging Deployment Verification

**Date:** 2026-11-10  
**Environment classification:** **Local pre-staging checks only** — no isolated staging host was available.  
**Public production deploy:** **Not performed** (not authorized).  
**Demo account deletion:** **Not performed**.

---

## Recommendation

# STAGING BLOCKED

Staging HTTPS deployment, live cookie/CSRF/refresh verification, Sentry smoke, two-shop workflow regression on staging, and manual NVDA/RTL/print acceptance were **not executable** without staging infrastructure credentials.

Local production builds and Atlas connectivity from the developer machine **passed**. Those do not substitute for staging HTTPS verification.

---

## 1. Deployment URL and environment

| Item | Value |
|------|--------|
| Staging frontend URL | **None** — not provisioned / not provided |
| Staging API URL | **None** — not provisioned / not provided |
| Deploy CLIs present | `vercel`, `railway`, `fly`, `gh` — **missing** on this machine |
| Staging env template | Added: `.env.staging.example` (placeholders only) |
| Local `.env` classification | `NODE_ENV=development`, `CLIENT_URL=http://localhost:5173` — **not** a staging HTTPS config |
| `SENTRY_DSN` (local) | **Absent** |
| Client Sentry DSN | **Absent** (`client/.env` not present) |

Secrets were validated for **presence only**; values are not recorded in this report.

---

## 2. Pre-deployment checks

### Documentation & templates

| Artifact | Status |
|----------|--------|
| `DEPLOYMENT.md` | Present (build/start, cookies, `/health` `/ready`, rollback, TLS) |
| `.env.production.example` | Present |
| `client/.env.production.example` | Present |
| `.env.staging.example` | **Created** this phase |
| `docs/PHASE6_2_PRODUCTION_PREP.md` | Present |
| `docs/MANUAL_ACCEPTANCE_CHECKLIST.md` | Present |

### Required variables (presence — no values disclosed)

| Variable | Local workspace | Staging host |
|----------|-----------------|--------------|
| `MONGODB_URI` | Configured (redacted) | **Unknown / not deployed** |
| `JWT_SECRET` | Configured (length not printed) | **Unknown** |
| `CLIENT_URL` | `http://localhost:5173` (dev) | **Missing staging HTTPS origin** |
| `USE_MEMORY_DB` | `false` | — |
| `SEED_ON_START` | `false` | — |
| `COOKIE_SECURE` | Unset locally (dev); code forces Secure in prod | Staging must set `true` under HTTPS |
| `SENTRY_DSN` / `PUBLIC_SENTRY_DSN` | **Absent** | **Required for monitoring gate** |

`npm run env:check -w server` → `mongodbUriConfigured: true`, `useMemoryDb: false`, Atlas/remote target redacted.

### Cookie / HTTPS requirements (code inspection)

| Check | Result |
|-------|--------|
| `COOKIE_SECURE=false` fatal in production | Code verified (`env.ts`) |
| Production `CLIENT_URL` requires `https://` (except localhost) | Code verified |
| Cookies use `env.cookieSecure` | Code verified (`cookies.ts`) |
| Default SameSite `lax` + CSRF double-submit | Code verified (prior phases) |
| Live HTTPS `Set-Cookie; Secure` | **Not verified** — no staging HTTPS |

### MongoDB Atlas

| Check | Result |
|-------|--------|
| Connect from this machine | **Pass** — `mode: "atlas"` (scripted connect/disconnect; URI redacted) |
| Dedicated staging cluster vs shared dev DB | **Unconfirmed** — treat current URI as **non-staging** until ops isolates a staging DB |
| Production customer data used | **Not claimed** — do not use production customer data for staging |

### Sentry

| Check | Result |
|-------|--------|
| Server/client instrumentation via env | Code present (Phase 6.2) |
| DSN configured in this environment | **Fail / absent** |
| `npm run monitor:smoke -w server` | Would fail without DSN (confirmed Phase 6.2) |

---

## 3. Build results

| Build | Command | Result |
|-------|---------|--------|
| API | `npm run build -w server` (`tsc`) | **Pass** (exit 0) |
| Web | `npm run build -w client` (`vite build` + `@sveltejs/adapter-node`) | **Pass** (exit 0, ~41s) |

No staging artifact was published to a remote host.

---

## 4. Staging deployment verification

| Check | Result | Notes |
|-------|--------|-------|
| Frontend loads over HTTPS | **Blocked** | No staging URL |
| API accessible over HTTPS | **Blocked** | No staging URL |
| `GET /health` on staging | **Blocked** | Not deployed |
| `GET /ready` on staging | **Blocked** | Not deployed |
| Swagger policy on staging | **Blocked** | Not deployed |
| Secure HttpOnly auth cookies | **Blocked** | Requires HTTPS host + browser DevTools |
| CSRF rejection without token | **Blocked** | Requires live staging API |
| Refresh rotation / logout / revoked session | **Blocked** | Requires live staging API |
| Sentry controlled test exception | **Blocked** | No `SENTRY_DSN` |

**Deployment action taken:** none (no credentials / host / CLI).

---

## 5. Workflow regression (two shops)

Intended coverage (shop onboarding, customer repair, mechanic flow, parts/GRN, supplier PO, payment/credit/reversal, reports, cross-shop denial) on **staging with separate accounts**.

| Area | Result |
|------|--------|
| Shop onboarding and approval | **Not run** (no staging) |
| Customer repair + tracking | **Not run** |
| Mechanic diagnosis + completion | **Not run** |
| Parts reservation + GRN | **Not run** |
| Supplier quotation + PO | **Not run** |
| Payment / credit note / reversal | **Not run** |
| Reports and exports | **Not run** |
| Cross-shop / cross-supplier denial | **Not run** |

Prior-phase automated Vitest/Playwright evidence exists in the repo but is **not** re-asserted here as staging verification.

---

## 6. Monitoring verification

| Item | Result |
|------|--------|
| Staging Sentry project/DSN | **Not configured** |
| Controlled exception received | **Not verified** |

---

## 7. Manual acceptance

| Check | Result |
|-------|--------|
| NVDA login / dashboards | **Not performed** |
| Keyboard-only | **Not performed** |
| Urdu RTL | **Not performed** |
| Mobile responsive | **Not performed** |
| A4 / 80mm / 58mm print | **Not performed** on staging |

Checklists remain ready: `docs/MANUAL_ACCEPTANCE_CHECKLIST.md`, `docs/NVDA_TEST_CHECKLIST.md`. Phase 6.1 print PDFs under `client/test-results/phase6.1-print/` are local automation evidence only — **not** staging manual Pass.

---

## 8. Remaining defects and blockers

### Blockers (must clear before STAGING PASS)

1. Provision isolated staging hosts (frontend HTTPS + API HTTPS) and DNS/TLS.
2. Configure staging secrets from `.env.staging.example` (including `CLIENT_URL=https://…`, `COOKIE_SECURE=true`, Atlas staging URI).
3. Install/authenticate deploy tooling (or use host dashboard) and deploy API + web.
4. Set Sentry staging DSNs; run `monitor:smoke` and confirm event in UI.
5. Execute HTTPS cookie/CSRF/refresh/logout checks in browser.
6. Run two-shop workflow suite against staging (non-production data).
7. Complete manual NVDA / keyboard / RTL / mobile / print on staging and record Pass/Fail.

### Non-blockers for staging prep

- Local `tsc` + client production builds succeed.
- Atlas reachable from developer machine (`dbMode` atlas).
- Deploy/rollback/docs/templates from Phase 6.2 remain usable.

---

## 9. What to do next (ops)

```bash
# After staging hosts + secrets exist:
# 1. Set host env from .env.staging.example (real values in secret store only)
# 2. Deploy API + client per DEPLOYMENT.md
# 3. curl https://<api>/health && curl https://<api>/ready
# 4. SENTRY_DSN=… npm run monitor:smoke -w server
# 5. Browser: Secure HttpOnly cookies + CSRF 403 without header
# 6. Fill docs/MANUAL_ACCEPTANCE_CHECKLIST.md on the staging URL
# 7. Re-open Phase 6.3 and update this file with measured results
```

---

## Related docs

- `DEPLOYMENT.md`
- `.env.staging.example`
- `docs/PHASE6_2_PRODUCTION_PREP.md`
- `docs/MANUAL_ACCEPTANCE_CHECKLIST.md`
- `docs/DEMO_ACCOUNT_CLEANUP_PLAN.md` (do not delete without approval)
