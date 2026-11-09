# RepairConnect — Deployment Guide

Do not deploy until production secrets and domains are configured. This guide does not perform a live deploy.

## Architecture

| Component | Runtime |
|-----------|---------|
| API | Node.js 20+ Express (`server/`) |
| Web | SvelteKit (`client/`) |
| Database | MongoDB Atlas (`repairconnect`) |
| Auth | HttpOnly JWT cookies (`rc_access`, `rc_refresh`) + double-submit CSRF (`rc_csrf`) |

## 1. MongoDB Atlas

1. Create/use an Atlas cluster and database user with least privilege.
2. Network Access: allow your app host IPs (prefer specific IPs over `0.0.0.0/0`).
3. Connection string: use `mongodb+srv://...` or the standard replica-set URI.
4. Database name used by the app: `repairconnect` (set in Mongoose connect options).
5. Seed **once** from a trusted machine (**never** in production `NODE_ENV`):

```bash
# Temporary .env for seeding (development machine only)
MONGODB_URI=<atlas-uri>
USE_MEMORY_DB=false
NODE_ENV=development
SEED_ON_START=false

npm run seed -w server
npm run verify:atlas -w server   # optional acceptance check
```

`npm run seed` and `seedDatabase()` throw if `NODE_ENV=production`.

## 2. Production environment variables

Set these on the **API host** (never commit real values; never expose to the frontend build):

| Variable | Required | Notes |
|----------|----------|--------|
| `NODE_ENV` | yes | Must be `production` |
| `MONGODB_URI` | yes | Atlas URI; missing → fatal exit |
| `USE_MEMORY_DB` | must be unset/`false` | `true` is fatal in production |
| `JWT_SECRET` | yes | ≥ 32 random characters |
| `CLIENT_URL` | yes | Exact frontend origin (CORS + credentialed cookies) |
| `CLIENT_URL_ALT` | optional | Extra allowed CORS origin |
| `PORT` | optional | Default `5000` |
| `SEED_ON_START` | must be unset/`false` | `true` is fatal in production |
| `ALLOW_DEMO_LOGIN` | must be unset/`false` | `true` is fatal in production; demo emails always blocked in prod |
| `COOKIE_SAME_SITE` | optional | Default `lax`. Use `none` for cross-site API (Secure forced) |
| `COOKIE_DOMAIN` | optional | Shared parent domain if needed (e.g. `.example.com`) |
| `ACCESS_TOKEN_TTL_SEC` | optional | Default `7200` |
| `REFRESH_TOKEN_TTL_SEC` | optional | Default `604800` |

Example (secrets managers / host env — not a committed file):

```env
NODE_ENV=production
MONGODB_URI=mongodb+srv://USER:PASS@CLUSTER/?retryWrites=true&w=majority
USE_MEMORY_DB=false
JWT_SECRET=<openssl-rand-hex-32-or-more>
CLIENT_URL=https://app.example.com
PORT=5000
SEED_ON_START=false
COOKIE_SAME_SITE=lax
```

Frontend build-time (optional):

| Variable | Notes |
|----------|--------|
| `VITE_API_URL` | Absolute API origin if frontend and API are on different hosts. Leave empty when same-origin reverse proxy is used (preferred for cookies). |

### Cookie / CORS notes

- Prefer **same-site** reverse proxy (`/api` → API) so cookies stay `SameSite=Lax` without cross-site issues.
- Split domains require `COOKIE_SAME_SITE=none` (Secure cookies), HTTPS, and matching `CLIENT_URL` / `VITE_API_URL`.
- Browser clients send `credentials: 'include'` and `X-CSRF-Token` on mutating requests.
- JWT access/refresh tokens are **not** returned in JSON outside `NODE_ENV=test`.

## 3. Express backend

```bash
cd Hackathon
npm install
npm run build -w server
NODE_ENV=production npm run start -w server
```

- Health: `GET /health` (expect `dbMode: "atlas"`)
- Swagger: `GET /api/docs` and `/api/docs.json` (relaxed CSP on docs mount only)
- Production Helmet CSP enabled for API JSON/HTML responses
- TLS termination on reverse proxy; app trusts `X-Forwarded-Proto` (`trust proxy`)

### Reverse proxy sketch

```nginx
# api.example.com → Node :5000
location / {
  proxy_pass http://127.0.0.1:5000;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-For $remote_addr;
}
```

## 4. SvelteKit frontend

**Adapters (selected at build time — see `client/svelte.config.js`):**

| Target | Adapter | How |
|--------|---------|-----|
| Node VPS / VM + nginx | `@sveltejs/adapter-node` | Default (`ADAPTER` unset or `ADAPTER=node`) |
| Vercel (frontend only) | `@sveltejs/adapter-vercel` | `VERCEL=1` (automatic on Vercel) or `ADAPTER=vercel` |

The Express API is **not** deployed on Vercel. Full Vercel monorepo settings: `docs/VERCEL_DEPLOYMENT_PLAN.md` and `client/vercel.json`.

Do **not** deploy until the chosen host has been explicitly confirmed and smoke-tested with HTTPS + cookies.

### 4a. Node VPS build

```bash
cd Hackathon
# If API is on another domain:
#   set VITE_API_URL=https://api.example.com
npm install
npm run build -w client
# Output: client/build  →  node client/build/index.js  (or process manager)
```

### 4b. Vercel frontend (API stays on persistent Node)

**Preferred (Git-connected project):**

| Setting | Value |
|---------|--------|
| Root Directory | `client` |
| Install Command | `cd .. && npm ci` (`client/vercel.json`) |
| Build Command | `npm run build` |
| Build env | `VITE_API_URL=https://<api-host>` (public only) |
| Forced adapter | `ADAPTER=vercel` via `client/vercel.json` `build.env` + platform `VERCEL=1` |

`svelte.config.js` selects `@sveltejs/adapter-vercel` whenever `VERCEL` is set (cannot fall through to adapter-node on Vercel). VPS builds remain default `adapter-node`.

**Local Windows note:** `adapter-vercel` requires filesystem symlinks (`fs.symlinkSync`). Without Windows Developer Mode / SeCreateSymbolicLinkPrivilege, local adapt fails with `EPERM`. That is a **host OS limitation**, not an application defect. Vercel’s Linux builders and `.github/workflows/vercel-client-build.yml` are the intended verification path — do not patch the adapter to avoid symlinks.

**Alternate (monorepo root as Vercel project):** root `vercel.json` runs `npm run build:vercel` (builds client, then `scripts/promote-vercel-output.mjs` → `.vercel/output`).

API host must set `CLIENT_URL` to the Vercel origin. Cross-site Vercel ↔ API requires `COOKIE_SAME_SITE=none` (Secure cookies). Prefer sibling custom domains under one parent when you want `SameSite=Lax` + `COOKIE_DOMAIN`.

- Production builds enable `kit.csp` (scripts `self`, Google Fonts allowed for brand typography, no `unsafe-eval`).
- Prefer same-origin `/api` proxy for cookie auth when both are on one VPS.
- Never put `JWT_SECRET`, `MONGODB_URI`, or provisioning keys in `VITE_*` variables.

### Same-host proxy sketch

```nginx
# app.example.com
location /api/ {
  proxy_pass http://127.0.0.1:5000/api/;
}
location /health {
  proxy_pass http://127.0.0.1:5000/health;
}
location / {
  # serve SvelteKit adapter output / upstream
}
```

## 5. Domain configuration checklist

- [ ] Frontend origin set as `CLIENT_URL`
- [ ] API reachable at documented base URL
- [ ] TLS certificates valid
- [ ] Atlas IP allowlist includes app servers
- [ ] `JWT_SECRET` rotated from any demo value
- [ ] Demo seed passwords changed **or** demo users disabled / deleted on Atlas
- [ ] `SEED_ON_START` not set in production
- [ ] `ALLOW_DEMO_LOGIN` not set in production
- [ ] `USE_MEMORY_DB` not set / false
- [ ] Confirm `Set-Cookie` shows `HttpOnly` on `rc_access` / `rc_refresh`, and `Secure` on HTTPS
- [ ] Confirm CSP headers on production frontend HTML
- [ ] Swagger exposure reviewed (restrict or protect in public prod if required)
- [ ] Complete `docs/NVDA_TEST_CHECKLIST.md` with a real NVDA session

## 6. Post-deploy smoke

```bash
curl -s https://api.example.com/health
# Login via UI with a non-demo account
# DevTools → Application: no JWT in localStorage; cookies HttpOnly
# Mutating API call without X-CSRF-Token should 403 CSRF_REJECTED
```

Do not run `verify:atlas` against production with destructive clear/seed without an explicit maintenance window.

## Related docs

- `docs/VERCEL_DEPLOYMENT_PLAN.md` — Vercel frontend + separate Express API plan
- `docs/PRODUCTION_READINESS.md` — GO/NO-GO audit package (architecture, security, tests, risks)
- `docs/BACKUP_RESTORE.md`
- `docs/SECURITY_VERIFICATION.md`
- `docs/NVDA_TEST_CHECKLIST.md`
- `FINAL_ACCEPTANCE_REPORT.md`
