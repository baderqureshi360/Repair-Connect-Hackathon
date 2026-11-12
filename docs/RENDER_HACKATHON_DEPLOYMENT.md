# RepairConnect — Render Hackathon Deployment

**Date:** 2026-11-11  
**Status:** Final deployment-readiness review complete. Live Render deploy **not** performed.  
**Blueprint file:** `render.yaml` (repo root)  
**Database:** existing MongoDB Atlas (unchanged)

---

## ASSUMPTIONS

1. You will deploy via the Render Dashboard Blueprint flow (or sync) after pushing `render.yaml` — this guide does not deploy for you.
2. Frontend and API use separate `*.onrender.com` HTTPS origins (cross-site cookies).
3. Secrets are entered in the Render Dashboard — never committed.
4. Atlas stays external; Render does not host MongoDB for this app.

---

## Final deployment-readiness report (2026-11-11)

Method: Blueprint vs [Render Blueprint spec](https://render.com/docs/blueprint-spec) + `https://render.com/schema/render.yaml.json`; local `js-yaml` + **Ajv draft-2020-12**; local production `vite build` with `ADAPTER=node`; source review of auth/CORS/health/uploads. **No live deploy.** No production DB changes. Secrets not printed.

### Ajv schema error (previous attempt) — root cause

| Item | Finding |
|------|---------|
| Exact error | `no schema with key or ref "https://json-schema.org/draft/2020-12/schema"` |
| Cause | Default `ajv` entrypoint compiles against **draft-07**. Render’s published schema declares **`$schema: https://json-schema.org/draft/2020-12/schema`**. Compiling that schema with default Ajv fails **before** validating `render.yaml`. |
| Re-test | `ajv/dist/2020.js` (Ajv2020) + `validateSchema: false` → **`render.yaml` validates with 0 errors** |
| Classification | **Local tooling mismatch — not a Render Blueprint / `render.yaml` failure** |
| Official CLI | Still **NOT VERIFIED** (`render` not on PATH). Prefer `render blueprints validate render.yaml` when available. |

### 1. Blueprint vs current Render spec

| Check | Result | Evidence |
|-------|--------|----------|
| Spec field set (`type`, `runtime`, `plan`, `region`, `buildCommand`, `startCommand`, `healthCheckPath`, `envVars`) | **PASS** | Matches Blueprint YAML reference; `plan: free` is a documented web Plan ID |
| Services `repairconnect-backend` + `repairconnect-frontend` | **PASS** | `type: web`, `runtime: node`, `plan: free`, `region: oregon` |
| Backend build / start | **PASS** | `npm ci && npm run build -w server` / `npm run start -w server` |
| Frontend build / start | **PASS** | `npm ci && npm run build -w client` / `node client/build/index.js` |
| Health paths | **PASS** (config) | Backend `/health`; frontend `/` |
| Env refs | **PASS** | `CLIENT_URL` / `VITE_API_URL` ← peer `RENDER_EXTERNAL_URL`; `MONGODB_URI` `sync: false`; `JWT_SECRET` `generateValue: true` |
| No committed secrets | **PASS** | No URI/password literals in YAML |
| JSON Schema (Ajv2020) | **PASS** | 0 errors against Render schema |
| Official `render blueprints validate` | **NOT VERIFIED** | CLI not installed |

### 2. `VITE_API_URL` production build proof (local)

| Check | Result | Evidence |
|-------|--------|----------|
| Available at SvelteKit/Vite production build | **PASS** | Built with `ADAPTER=node` `NODE_ENV=production` `VITE_API_URL=https://repairconnect-backend.onrender.com` |
| URL baked into client + SSR bundles | **PASS** | String present in `client/build/client/_app/...` and `client/build/server/chunks/...` (e.g. `const API_BASE = "https://repairconnect-backend.onrender.com"`) |
| Rebuild after URL finalized | **PASS** (local) | Second build with `VITE_API_URL=https://example-final-backend.onrender.com` → new URL in 15 build files; previous URL count **0**; `client/build/index.js` present |
| Live Render hostname match | **NOT VERIFIED** | Must equal real backend `RENDER_EXTERNAL_URL` after Dashboard create |
| Auto rebuild on Render when peer URL changes | **NOT VERIFIED** | Still require Dashboard **Manual Deploy → Clear build cache & deploy** on frontend after any `VITE_API_URL` change |

### 3. Auth for split Render domains (code + Blueprint; not live)

| Check | Result | Evidence |
|-------|--------|----------|
| SameSite=None | **PASS** (config/code) | Blueprint `COOKIE_SAME_SITE=none` → cookie options |
| Secure | **PASS** (config/code) | `COOKIE_SECURE=true`; production forbids `false` |
| HttpOnly access/refresh | **PASS** | `rc_access` / `rc_refresh` `httpOnly: true` |
| CSRF cookie readable | **PASS** | `rc_csrf` `httpOnly: false`; login/refresh also return JSON `csrfToken` (required cross-site) |
| CORS exact origin + credentials | **PASS** | Allowlist `CLIENT_URL` (+ optional alt); `credentials: true`; client `credentials: 'include'`; no `*` |
| Refresh token rotation | **PASS** (code) | `POST /api/v1/auth/refresh` rotates session, resets cookies + `csrfToken`; client `tryRefresh()` on 401 |
| Live HTTPS cookie/CORS on Render | **NOT VERIFIED** | Needs deployed services + browser DevTools |

### 4. Health, Atlas, uploads/docs

| Check | Result | Evidence |
|-------|--------|----------|
| `GET /health` | **PASS** (code) | Unauthenticated liveness JSON + `dbMode` |
| Bind `0.0.0.0` + `PORT` | **PASS** | `HOST` default / Blueprint `0.0.0.0`; `env.port` from `PORT` |
| Frontend `/` live | **NOT VERIFIED** | |
| Atlas from Render | **NOT VERIFIED** | Needs `MONGODB_URI` + Atlas Network Access; confirm via `/ready` |
| Uploads / documents not on temp disk | **PASS** | Mongo-backed photos + financial docs; print via browser; no API multer/disk path |

### Verdict

**Ready for first manual Render Blueprint create.** No application redesign required. Complete §11 before claiming the demo works end-to-end.

---

## 1. Repository inspection (source of truth)

| Item | Finding |
|------|---------|
| Workspaces | Root `package.json` → `server`, `client` |
| Lockfile | `package-lock.json` (use `npm ci`) |
| Node | Root `engines.node` `>=20`; client `20.x` |
| API build / start | `npm run build -w server` → `tsc`; `npm run start -w server` → `node dist/index.js` |
| Web build / start | `npm run build -w client` → Vite + **`@sveltejs/adapter-node`** → `client/build`; start with `node client/build/index.js` |
| Adapter selection | `client/svelte.config.js`: default / `ADAPTER=node` → adapter-node; `VERCEL` / `ADAPTER=vercel` → adapter-vercel |
| Frontend API env | **`VITE_API_URL`** (`client/src/lib/api.ts`, `apiList.ts`, track/registration pages) |
| CORS / cookies | `CLIENT_URL` (+ optional `CLIENT_URL_ALT`); `COOKIE_SAME_SITE`; `COOKIE_SECURE` |
| Health | `GET /health` (liveness); `GET /ready` (DB connected) |
| Uploads / docs | Photos stored as URL/base64 strings in Mongo; financial documents in Mongo — **no temp disk dependency** for API serving |
| Existing guides | `DEPLOYMENT.md`, `docs/VERCEL_DEPLOYMENT_PLAN.md`, `.env.example`, `.env.production.example` |

### Scripts used by the Blueprint (do not invent others)

| Service | Build | Start |
|---------|-------|-------|
| Backend | `npm ci && npm run build -w server` | `npm run start -w server` |
| Frontend | `npm ci && npm run build -w client` | `node client/build/index.js` |

Root `npm run build` builds **both** workspaces; Blueprint builds each workspace separately to keep services independent.

---

## 2. What `render.yaml` creates

| Service name | Type | Plan | Role |
|--------------|------|------|------|
| `repairconnect-backend` | web / node | `free` | Express API |
| `repairconnect-frontend` | web / node | `free` | SvelteKit adapter-node |

- **Region:** `oregon` (change in YAML/Dashboard if you prefer another region; keep both services in the same region).
- **No** Render Postgres / Redis — Atlas only.
- **No** `rootDir` — commands run from the **repo root** so npm workspaces resolve correctly.

Expected public URLs (exact host may get a Render suffix if the name is taken):

- Backend: `https://repairconnect-backend.onrender.com`
- Frontend: `https://repairconnect-frontend.onrender.com`

---

## 3. Dashboard steps (exact)

### 3.1 Prerequisites

1. Push this repo (including `render.yaml`) to GitHub / GitLab / Bitbucket.
2. MongoDB Atlas cluster ready; connection string available.
3. Atlas **Network Access**: allow Render egress. For a hackathon free tier, many teams temporarily allow `0.0.0.0/0` (verify Atlas policy for your event). Prefer locking down after demo if possible.
4. Create a [Render](https://dashboard.render.com/) account and open the target workspace.

### 3.2 Create Blueprint

1. Dashboard → **New** → **Blueprint**.
2. Connect the Git provider and select the **RepairConnect** repository.
3. Branch: usually `main` (or your deploy branch).
4. Blueprint path: `render.yaml` (repo root).
5. Review the two services: `repairconnect-backend`, `repairconnect-frontend`.
6. When prompted for **`MONGODB_URI`** (`sync: false`), paste your Atlas URI (no quotes).
7. Confirm **`JWT_SECRET`** will be auto-generated (`generateValue: true`) or replace with your own ≥32-character secret in the Dashboard after create.
8. Apply / create the Blueprint. **Do not** enable demo seed or memory DB.

### 3.3 After first sync — verify cross-service URLs

Blueprint wires:

| Variable | Service | Source |
|----------|---------|--------|
| `CLIENT_URL` | backend | Frontend `RENDER_EXTERNAL_URL` |
| `VITE_API_URL` | frontend | Backend `RENDER_EXTERNAL_URL` |

**Manual verification (required):**

1. Open each service → **Settings** → copy its public URL.
2. Backend → **Environment** → confirm `CLIENT_URL` equals the frontend origin **exactly** (scheme + host, no trailing slash).
3. Frontend → **Environment** → confirm `VITE_API_URL` equals the backend origin **exactly**.
4. If either is wrong/empty: set the correct value manually, then **Manual Deploy** → **Clear build cache & deploy** on the **frontend** (Vite bakes `VITE_API_URL` at build time). Redeploy backend if `CLIENT_URL` changed.

### 3.4 Atlas + JWT checks

| Check | Action |
|-------|--------|
| Atlas URI | Includes credentials; app uses DB name `repairconnect` via Mongoose `dbName` |
| `USE_MEMORY_DB` | Must be `false` |
| `JWT_SECRET` | ≥ 32 characters in production |
| Seed / demo | `SEED_ON_START=false`, `ALLOW_DEMO_LOGIN=false` (fatal if `true` in production) |

Seed Atlas **once from a trusted local machine** (never with `NODE_ENV=production` on the server):

```bash
# Local machine only — development NODE_ENV
npm run seed -w server
```

### 3.5 Smoke test (after both services are Live)

```bash
curl -sS https://<backend-host>/health
curl -sS https://<backend-host>/ready
```

Expect `/health` → `success: true`, `dbMode: "atlas"`.  
Open the frontend URL → login → DevTools:

- Network: API calls go to `VITE_API_URL` with `credentials: include`
- Application → Cookies on the **API** host: `rc_access` / `rc_refresh` **HttpOnly; Secure; SameSite=None**
- Mutating request without `X-CSRF-Token` → `403` `CSRF_REJECTED`

---

## 4. Service settings reference

### Backend (`repairconnect-backend`)

| Setting | Value |
|---------|--------|
| Runtime | Node |
| Plan | Free |
| Build | `npm ci && npm run build -w server` |
| Start | `npm run start -w server` |
| Health check | `/health` |
| Bind | `HOST=0.0.0.0`, `PORT` from Render |
| Trust proxy | Already `app.set('trust proxy', 1)` in `server/src/app.ts` |

### Frontend (`repairconnect-frontend`)

| Setting | Value |
|---------|--------|
| Runtime | Node |
| Plan | Free |
| Build | `npm ci && npm run build -w client` |
| Start | `node client/build/index.js` |
| Adapter | `@sveltejs/adapter-node` via `ADAPTER=node` (do **not** set `VERCEL`) |
| Health check | `/` |
| Bind | adapter-node defaults to `0.0.0.0`; Blueprint sets `HOST=0.0.0.0` |
| Proxy headers | `PROTOCOL_HEADER=x-forwarded-proto`, `HOST_HEADER=x-forwarded-host` |

---

## 5. Environment variables

### Backend (runtime) — required

| Variable | Blueprint | Notes |
|----------|-----------|--------|
| `NODE_ENV` | `production` | Required |
| `MONGODB_URI` | Dashboard prompt | Atlas URI; never put in `VITE_*` |
| `USE_MEMORY_DB` | `false` | `true` is fatal in production |
| `JWT_SECRET` | generated | ≥ 32 chars |
| `CLIENT_URL` | from frontend URL | Exact browser origin |
| `COOKIE_SECURE` | `true` | Production forbids `false` |
| `COOKIE_SAME_SITE` | `none` | Required for split `*.onrender.com` hosts |
| `HOST` | `0.0.0.0` | Render health checks |
| `PORT` | Render-provided | Do not hardcode over Render’s value |
| `SEED_ON_START` | `false` | Fatal if `true` in production |
| `ALLOW_DEMO_LOGIN` | `false` | Fatal if `true` in production |

### Backend — optional (set in Dashboard if needed)

| Variable | Notes |
|----------|--------|
| `CLIENT_URL_ALT` | Extra CORS origin |
| `COOKIE_DOMAIN` | Only for sibling custom domains under one parent (e.g. `.example.com`) — **not** for default onrender.com split hosts |
| `ACCESS_TOKEN_TTL_SEC` | Default `7200` |
| `REFRESH_TOKEN_TTL_SEC` | Default `604800` |
| `PROVISIONING_API_KEY` | Min 16 chars when set |
| `SENTRY_DSN` / `SENTRY_ENVIRONMENT` / `SENTRY_TRACES_SAMPLE_RATE` | Server monitoring |

### Frontend (build + runtime)

| Variable | Blueprint | Notes |
|----------|-----------|--------|
| `VITE_API_URL` | from backend URL | **Build-time**; absolute API origin |
| `ADAPTER` | `node` | Keeps adapter-node |
| `NODE_ENV` | `production` | |
| `HOST` | `0.0.0.0` | |
| `PROTOCOL_HEADER` / `HOST_HEADER` | set | Correct HTTPS origin behind Render |
| `PUBLIC_SENTRY_DSN` | unset by default | Optional browser DSN only |

**Never** expose `MONGODB_URI`, `JWT_SECRET`, or `PROVISIONING_API_KEY` as `VITE_*` / `PUBLIC_*` secrets.

Templates (no secrets): `.env.example`, `.env.production.example`, `client/.env.production.example`.

---

## 6. CORS, cookies, CSRF, HTTPS (split Render domains)

| Topic | Behavior on Render free Blueprint |
|-------|-----------------------------------|
| Origins | Frontend `https://…-frontend…` ≠ API `https://…-backend…` → **cross-site** |
| CORS | API allowlists `CLIENT_URL` (and optional `CLIENT_URL_ALT`) with `credentials: true` |
| Cookies | `rc_access` / `rc_refresh` HttpOnly; `rc_csrf` readable by JS **on the API host** |
| SameSite | Blueprint sets `COOKIE_SAME_SITE=none` + `COOKIE_SECURE=true` |
| HTTPS | Render terminates TLS; Express trusts `X-Forwarded-*` |
| CSRF | Double-submit: browser sends API cookie + `X-CSRF-Token` header. Cross-site: CSRF value comes from **login/refresh JSON** (`csrfToken` → in-memory store), not from `document.cookie` on the frontend origin (API cookies are not readable cross-origin). |
| `COOKIE_DOMAIN` | Leave unset for default onrender.com hosts |

If login works but later POSTs get `CSRF_REJECTED`, confirm the client still has the in-memory CSRF from the last auth response and that `VITE_API_URL` matches the cookie-setting host.

---

## 7. File uploads and generated documents

| Concern | Finding |
|---------|---------|
| Photo uploads | Validated string URLs / data URLs (size-capped) stored on repair documents in **MongoDB** |
| Financial / print documents | Issued as Mongo records + client-side print/PDF flows — **no** server `fs` / `/tmp` / multer disk path in API services |
| Free tier filesystem | Ephemeral; wiped on spin-down/restart — acceptable because runtime data is in Atlas |

**Manual verification:** run one photo upload and one document issue/print path on the live URLs after deploy.

---

## 8. Free-tier constraints (hackathon)

| Limit | Impact |
|-------|--------|
| Spin down after ~15 min idle | ~1 min cold start on next request — wake **backend first**, then frontend |
| 750 free instance hours / workspace / month | Shared by **both** web services while awake |
| 512 MB RAM / service | Monitor OOM on heavy builds or large base64 photos |
| No persistent disk | Do not rely on local files |
| No free private networking between free web services | Browser talks to public HTTPS URLs only |

---

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Deploy health check fails | Not listening on `0.0.0.0:$PORT` | Confirm `HOST=0.0.0.0`; backend uses `process.env.PORT` |
| Backend crash on boot | Missing/invalid `MONGODB_URI`, weak `JWT_SECRET`, or forbidden flags | Check logs; align with `.env.production.example` |
| `/health` ok but `/ready` 503 | Atlas unreachable / IP allowlist | Fix Atlas Network Access; recheck URI |
| Browser CORS errors | `CLIENT_URL` ≠ actual frontend origin | Exact match; redeploy backend |
| Login cookie missing | `COOKIE_SAME_SITE` not `none`, or mixed HTTP | Keep HTTPS + `none` + `Secure` |
| API calls hit frontend origin | Empty/`wrong` `VITE_API_URL` baked at build | Fix env → **Clear build cache & deploy** frontend |
| CSRF 403 after login | CSRF only in cookie path; cross-site store empty | Confirm login JSON includes `csrfToken`; refresh flow updates store |
| Frontend serves adapter-vercel layout / wrong output | `VERCEL` set or `ADAPTER=vercel` | Unset `VERCEL`; `ADAPTER=node`; rebuild |
| OOM during `npm ci` / build | Free 512 MB | Retry; slim install; or temporary paid plan for build |
| Cold start timeout during judging | Both services slept | Hit `/health` then frontend URL ~1–2 min before demo |

---

## 10. Blueprint validation

| Check | Result |
|-------|--------|
| Render CLI on this machine | **Not installed** (`render` not on PATH). WinGet package available: `Render.CLI` |
| `js-yaml` parse | **PASS** |
| Render JSON Schema via Ajv **draft-2020-12** | **PASS** (0 errors). Prior default-Ajv error was tooling-only (see Final report). |
| Official `render blueprints validate` | **NOT VERIFIED** — still pending |

To validate officially after installing the [Render CLI](https://render.com/docs/cli) (v2.7.0+):

```bash
render blueprints validate render.yaml
```

IDE option: Red Hat YAML extension + schema `https://render.com/schema/render.yaml.json` for `render.yaml`.

---

## 11. Exact remaining manual steps (checklist)

Complete in order. Do not skip rebuild steps for `VITE_API_URL`.

### A. Before Blueprint create

- [ ] Push repo including `render.yaml` to the Git host Render will use.
- [ ] (Recommended) Install Render CLI and run `render blueprints validate render.yaml` → expected **PASS**.
- [ ] Confirm Atlas cluster is up; copy `MONGODB_URI` (do not commit it).
- [ ] Atlas **Network Access**: allow Render egress (hackathon often `0.0.0.0/0` — confirm event policy).
- [ ] If demo data needed: seed **locally** with `NODE_ENV` ≠ `production` via `npm run seed -w server` against Atlas.

### B. Blueprint create (Dashboard)

- [ ] **New → Blueprint** → select repo → `render.yaml`.
- [ ] Enter **`MONGODB_URI`** when prompted (`sync: false`).
- [ ] Confirm **`JWT_SECRET`** is generated (≥ 32 chars) or replace with your own in Dashboard.
- [ ] Confirm services appear: `repairconnect-backend`, `repairconnect-frontend`, plan **Free**.
- [ ] Wait until both services show a public URL (note any Render name suffixes).

### C. Cross-service URL verification (required)

- [ ] Backend env **`CLIENT_URL`** === frontend origin exactly (`https://…`, no trailing slash).
- [ ] Frontend env **`VITE_API_URL`** === backend origin exactly.
- [ ] If either wrong/empty: set manually.
- [ ] Frontend → **Manual Deploy → Clear build cache & deploy** (mandatory after any `VITE_API_URL` change). Local proof: a second `vite build` with a new `VITE_API_URL` replaces the baked URL in `client/build` (old URL absent).
- [ ] Redeploy backend if `CLIENT_URL` was corrected.
- [ ] Optional local dry-run before Dashboard: `ADAPTER=node NODE_ENV=production VITE_API_URL=https://<real-backend> npm run build -w client` then confirm the URL appears under `client/build` (gitignored via `build/`).

### D. Live smoke (required before demo)

- [ ] `curl -sS https://<backend>/health` → `success: true`, prefer `dbMode: "atlas"`.
- [ ] `curl -sS https://<backend>/ready` → HTTP 200 (Atlas connected).
- [ ] `curl -sS -o /dev/null -w "%{http_code}" https://<frontend>/` → `200`.
- [ ] Browser: open frontend → login (non-forbidden demo policy in production).
- [ ] DevTools → Network: API host = `VITE_API_URL`; requests use credentials.
- [ ] DevTools → Application → cookies on **API** host: `rc_access` / `rc_refresh` = **HttpOnly; Secure; SameSite=None**; `rc_csrf` present (not HttpOnly).
- [ ] Mutating API call without `X-CSRF-Token` → `403` `CSRF_REJECTED`.
- [ ] One photo upload + one document issue/print path succeeds (data in Atlas / browser print — not local disk).

### E. Demo-day ops

- [ ] ~1–2 minutes before judging: wake backend (`/health`) then frontend (`/`) to avoid cold-start timeouts.
- [ ] Watch free-tier **750 instance hours** shared by both services.

---

## 12. Rollback / undeploy

1. Dashboard → service → **Suspend** or delete the Blueprint resources.
2. Atlas data is **not** deleted by removing Render services — treat Atlas separately.
3. Previous deploys: Free plan keeps limited rollback history (see Render docs).

---

## Related docs

- `DEPLOYMENT.md` — general production / VPS guide
- `docs/VERCEL_DEPLOYMENT_PLAN.md` — alternate frontend hosting (not used by this Blueprint)
- `.env.example` / `.env.production.example` / `client/.env.production.example`
