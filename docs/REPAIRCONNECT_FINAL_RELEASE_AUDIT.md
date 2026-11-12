# RepairConnect — Final Porto Release Audit

**Audit dates:** 2026-11-10 / 2026-11-11 (Phase 1) · **Phase 2 closure:** 2026-11-11  
**Scope:** Porto stabilization + deployment-readiness closure.  
**Not performed:** Live deploy, credential rotation, demo deletion, production config changes.

---

## Overall verdict: **CONDITIONAL GO**

| Layer | Decision |
|-------|----------|
| Application / Porto release (tests + builds) | **GO** — Phase 2 full Playwright **42/42** exit 0; svelte-check 0; server Vitest 138/138; builds pass |
| Production cutover | **NO-GO** until HTTPS host verification, Atlas Cloud Backup/PITR sign-off, demo cleanup approval, and Zod high triage |

Phase 1 was **CONDITIONAL PASS**. Phase 2 closed the Playwright stability blocker without weakening production rate-limit code (Playwright `webServer` starts the API with its documented E2E env only).

Do **not** treat this document as permission to deploy, delete data, or rotate secrets.

---

## Phase 2 — Resolved blockers

| Blocker | Resolution | Evidence |
|---------|------------|----------|
| Playwright suite instability | Full suite green | `npx playwright test` → **42 passed**, **0 failed**, **0 skipped**, exit **0** (8.5m) |
| Marketing registration flake | Independent re-run | `tests/marketing.spec.ts:25` → **1 passed**, exit **0** |
| Supplier review lifecycle | Isolated stamp data + Atlas report-cap annotation | `tests/supplier-network-phase5a.spec.ts` → **1 passed**, exit **0** |
| Demo inventory incomplete | Expanded read-only `demo:list` | Fresh JSON 2026-11-11; plan updated |
| HTTPS/cookie ops ambiguity | Checklist prepared (below) | Code-ready; live host still unverified |
| Backup mechanics | Isolated probe PASS | `npm run probe:backup-restore -w server` exit **0** (does **not** prove Atlas Cloud Backup) |

---

## Phase 2 — Remaining blockers (production cutover)

| ID | Severity | Item | Status |
|----|----------|------|--------|
| R1 | **Critical (ops)** | Live HTTPS + Secure cookie verification on real host | **Unverified** — checklist only |
| R2 | **Critical (ops)** | Demo `@repairconnect.local` accounts still active on Atlas | **Inventoried**; deletion **not** approved/executed |
| R3 | **High (ops)** | Atlas Continuous Backup / PITR / last successful snapshot | **Unverified** — no Atlas CLI/UI access this session |
| R4 | **High (deps)** | Zod `<4.6.6` high (runtime); fix is major (`zod@4`) | **Open** — no blind `audit fix --force` |
| R5 | **Medium** | 26 distinct E2E supplier businesses + financial test history on demo shops | Cleanup plan; needs approval |
| R6 | **Low** | NVDA checklist; client Vitest file count = 0 | Process / coverage shape |

---

## 1. Playwright evidence (Phase 2)

### Commands and exit codes

| Command | Exit | Counts |
|---------|------|--------|
| `npx playwright test tests/marketing.spec.ts:25` | **0** | 1 passed |
| `npx playwright test tests/supplier-network-phase5a.spec.ts` | **0** | 1 passed |
| `npx playwright test` (full suite) | **0** | **42 passed / 0 failed / 0 skipped** |

**How rate limits were handled:** Port `:5000` was left free so Playwright’s `webServer` started the API with `DISABLE_AUTH_RATE_LIMIT=1` from `client/playwright.config.ts` only. Production rate-limit code was not changed. Manual `DISABLE_AUTH_RATE_LIMIT` outside Playwright was **not** used (blocked by policy).

### Defect vs environment classification

| Observation | Class |
|-------------|--------|
| Full suite 42/42 | Application + test harness **PASS** |
| Prior `REPORT_RATE_LIMIT` on review report | **Environment / shared Atlas data** — phase5a annotates when 429; review submit/edit/response still asserted |
| Prior auth `RATE_LIMIT` when reusing a non-Playwright API | **Environment** — reuseExistingServer without E2E flag |

Logs: `%TEMP%\rc-p2-marketing.txt`, `rc-p2-phase5a.txt`, `rc-p2-playwright-full.txt`.

---

## 2. Typecheck / unit / build (carried forward + still valid)

| Command | Exit | Result |
|---------|------|--------|
| `npm run check -w client` | 0 | 0 errors, 0 warnings |
| `npm run build -w server` | 0 | `tsc` OK |
| `npm run build -w client` | 0 | Production build OK |
| `npm test -w server` | 0 | **138 / 138** (27 files) |
| `npm test -w client` | 0 | 0 unit files (`passWithNoTests`) |

---

## 3. HTTPS and deployment configuration checklist

**Status: READY TO CONFIGURE — not verified on a live host.**  
Do not deploy until each item is checked on staging/production.

### Domain and DNS

- [ ] Choose production web origin (e.g. `https://app.example.com`) and API origin (same-site preferred: `https://app.example.com/api` via reverse proxy, **or** `https://api.example.com`)
- [ ] DNS A/AAAA (or CNAME) for web and API hosts
- [ ] Optional: `COOKIE_DOMAIN=.example.com` only if sharing cookies across subdomains

### TLS

- [ ] Valid TLS certificate on the edge (Let’s Encrypt / cloud LB)
- [ ] HTTP → HTTPS redirect
- [ ] HSTS enabled at edge (recommended)

### Cookies (Secure / HttpOnly / SameSite)

| Cookie | Expected |
|--------|----------|
| `rc_access` | HttpOnly; Secure in production; path `/` |
| `rc_refresh` | HttpOnly; Secure in production; rotation + reuse detection server-side |
| `rc_csrf` | Readable by JS for double-submit; pair with `X-CSRF-Token` |

- [ ] `NODE_ENV=production` (forces Secure; `COOKIE_SECURE=false` is fatal)
- [ ] Prefer `COOKIE_SAME_SITE=lax` with **same-site** reverse proxy
- [ ] If split origins (e.g. Vercel + separate API): `COOKIE_SAME_SITE=none` + HTTPS + `CLIENT_URL` / `VITE_API_URL` exact match
- [ ] Confirm `Set-Cookie` in browser DevTools on real HTTPS login

### CSRF / CORS

- [ ] `CLIENT_URL` = exact frontend origin (required in production)
- [ ] Optional `CLIENT_URL_ALT` for a second origin only
- [ ] No `*` CORS with credentials
- [ ] Mutating browser calls send `credentials: 'include'` + `X-CSRF-Token`

### Reverse proxy / trust proxy

- [ ] Edge sets `X-Forwarded-Proto` and `X-Forwarded-For`
- [ ] Express `trust proxy` remains enabled so Secure cookies and rate limits see HTTPS
- [ ] Prefer proxying `/api` and `/health` to Node API; static/SSR to SvelteKit (or Vercel per `docs/VERCEL_DEPLOYMENT_PLAN.md`)

### Frontend / backend production origins

| Surface | Variable | Example |
|---------|----------|---------|
| API | `CLIENT_URL` | `https://app.example.com` |
| Web build (split hosts) | `VITE_API_URL` | `https://api.example.com` |
| Web build (same-origin proxy) | `VITE_API_URL` | empty |

Also confirm: `ALLOW_DEMO_LOGIN` unset/false, `SEED_ON_START` unset/false, `USE_MEMORY_DB` false, `JWT_SECRET` ≥ 32 chars, `PROVISIONING_API_KEY` set for ops only.

Authoritative runbooks: `DEPLOYMENT.md`, `.env.example`, `docs/VERCEL_DEPLOYMENT_PLAN.md`.

---

## 4. MongoDB Atlas backups

| Check | Result |
|-------|--------|
| Atlas CLI / mongocli on audit machine | **Not installed** |
| Continuous Backup / PITR enabled | **UNVERIFIED** |
| Backup retention / recovery window | **UNVERIFIED** |
| Last successful snapshot | **UNVERIFIED** |
| Restore procedure documented | **PASS** — `docs/BACKUP_RESTORE.md` |
| Isolated app restore probe | **PASS** — `repairconnect_p6_backup_probe`, exit 0; `productionDbTouched: false` |

**Do not claim Cloud Backup is enabled.** Ops must open Atlas → Cluster → Backup and record: policy, PITR window, retention, latest **Succeeded** snapshot id/time.

---

## 5. Demo account cleanup (inventory only)

Full plan: `docs/DEMO_ACCOUNT_CLEANUP_PLAN.md` (updated 2026-11-11).  
**No records deleted. No passwords rotated.**

### Users (18 `@repairconnect.local`)

Seed/core: `customer@`, `mechanic@`, `mechanic.khi@`, `parts@`, `admin@`, `supplier@`, `p4.e2e.ops@`  
Plus 11× `customer-b-*@repairconnect.local` from account-switch / E2E.

### Shops (2)

| Code | Name | Email |
|------|------|-------|
| LHR01 | Lahore Tech Repair | `lhr@repairconnect.local` |
| KHI01 | Karachi Device Hub | `khi@repairconnect.local` |

### Suppliers

| Item | Detail |
|------|--------|
| Demo supplier user | `supplier@repairconnect.local` |
| Demo supplier business | `SUP-B087B4C3B2A3` Porto Demo Supplier Hub |
| E2E supplier businesses via demo-shop POs | **26** distinct (ephemeral `@example.com` actors — separate cleanup) |

### Related dependency counts (demo shops / demo supplier)

| Artifact | Count |
|----------|------:|
| Memberships | 24 |
| Repairs | 79 |
| Parts | 7 |
| Appointments | 1 |
| Payments | 27 |
| Purchase orders | 35 |
| Goods receipts | 34 |
| Supplier ledger entries | 69 |
| Supplier reviews | 14 |

**Retention:** Snapshot Atlas before wipe; financial test history needs explicit approval to delete.

---

## 6. Dependency audit (no blind upgrades)

### Production tree (`npm audit --omit=dev`)

| Severity | Count | Notes |
|----------|------:|-------|
| High | 1 | **zod** `<4.6.6` — GHSA-mrhx-c7xc-m3w5; `audit fix --force` → **zod@4** (breaking) |
| Moderate | 3 | glob / minimatch via swagger-jsdoc |
| Low | 7 | SvelteKit/cookie/deepmerge chain; Kit major upgrade risk |
| **Total** | **11** | exit 1 |

Server pins `zod@^3.24.1`. Upgrade requires a dedicated Zod 4 migration — **not** performed.

### Full tree (`npm audit`)

| Severity | Count | Notes |
|----------|------:|-------|
| Critical | 2 | **tinypool** via Vitest (dev) |
| High | 2 | zod + additional |
| Moderate / Low | 16 | various |
| **Total** | **20** | exit 1 |

### Breaking upgrade risks

- `zod` 3 → 4  
- `@sveltejs/kit` force path → 3.x  
- `vitest` force path → 5.x (tinypool)

### Unused / notable

- Root workspace depends on `mongodb` directly (scripts/tools) — leave unless proven unused  
- No automated unused-dep purge this phase  

**Action:** Schedule Zod 4 + swagger-jsdoc/minimatch triage under change control; do not run `npm audit fix --force` on release day.

---

## 7. Fixed defects (Phase 1 + Phase 2)

| ID | Severity | Fix |
|----|----------|-----|
| F1–F8 | High/Medium | Phase 1: login AA, svelte-check, marketing selectors, staff shopId, dual-approval receive/reserve, vitest split, link contrast |
| F9 | Medium | Phase 2: Playwright stability verified green under Playwright-started API |
| F10 | Low | Phase 2: `demo:list` supplier/finance inventory fields corrected |

---

## 8. Security / multi-tenant / finance (unchanged PASS)

Tenant isolation, staff escalation prevention, CSRF cookies, dual-approval, lifecycle payments, supplier PO/GRN — covered by full Playwright 42/42 and server Vitest 138/138. See Phase 1 sections for detail.

---

## 9. Screenshots and print evidence

- Porto UI: `docs/screenshots/porto-*.png`  
- Print PDFs: `client/test-results/phase6.1-print/*.pdf`  
- Design system: `docs/PORTO_UI_DESIGN_SYSTEM_REPORT.md`

---

## 10. Production deployment blockers (ordered)

1. **HTTPS host** — complete §3 checklist on staging; capture Secure `Set-Cookie` evidence.  
2. **Atlas Cloud Backup / PITR** — enable/confirm in Atlas UI; record last successful snapshot; restore drill.  
3. **Demo cleanup** — approve then execute `docs/DEMO_ACCOUNT_CLEANUP_PLAN.md` (or rotate passwords).  
4. **Zod high** — planned non-breaking or Zod 4 migration.  
5. Explicit written approval before deploy / delete / rotate.

---

## 11. Classification roll-up (after Phase 2)

| Severity | Open | Notes |
|----------|-----:|-------|
| Critical | 2 | HTTPS host unverified; demo accounts still live |
| High | 2 | Atlas backup unverified; Zod high |
| Medium | 1 | E2E supplier/finance residue on Atlas |
| Low | 2 | NVDA; no client unit tests |

---

## 12. Final decision

| Question | Answer |
|----------|--------|
| Ship Porto application build to staging for ops hardening? | **CONDITIONAL GO** (tests/builds green) |
| Production cutover / public URL? | **NO-GO** until R1–R4 closed |
| Deploy / delete / rotate now? | **No** — requires explicit approval |
