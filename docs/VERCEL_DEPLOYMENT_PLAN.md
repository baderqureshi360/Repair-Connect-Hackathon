# RepairConnect — Vercel Deployment Plan (Phase 1 Inspection)

**Date:** 2026-11-09  
**Status:** Inspection complete. Live deploy **not** performed.  
**Constraint:** Frontend → Vercel. Backend → persistent Node Express (not Vercel serverless). Database → existing MongoDB Atlas (no migration).

---

## ASSUMPTIONS

1. The Express API remains on a separate always-on host (VPS / Railway / Render / Fly / similar).
2. Vercel hosts **only** the SvelteKit `client` workspace.
3. Production browser origin and API origin will differ unless you later add a same-site custom domain pair (`app.` + `api.`).
4. You will set secrets in host dashboards — none committed to Git.

---

## 1. Monorepo inspection

| Item | Finding |
|------|---------|
| Workspaces | Root `package.json` → `server`, `client` |
| Lockfile | `package-lock.json` (npm workspaces) |
| Client | SvelteKit 2 + Vite 6; scripts `dev` / `build` / `preview` |
| Server | Express + `tsc` → `dist/`; `start` = `node dist/index.js` |
| Current web adapter | `@sveltejs/adapter-node` in `client/svelte.config.js` |
| Existing deploy docs | `DEPLOYMENT.md` (Node VPS + nginx) |
| Vercel config today | **None** (`vercel.json` absent) |

---

## 2. Safest Vercel adapter configuration

Use **`@sveltejs/adapter-vercel`** for Vercel builds.

Preserve Node VPS builds with a single non-fragile switch:

- Default / local / explicit VPS: `@sveltejs/adapter-node` (`out: 'build'`)
- When `VERCEL=1` (set automatically by Vercel) **or** `ADAPTER=vercel`: `@sveltejs/adapter-vercel`

Do **not** put the Express app behind adapter-vercel or as a Vercel serverless function.

Recommended adapter options:

```js
adapterVercel({ runtime: 'nodejs20.x' })
```

Pin `nodejs20.x` so local builds on newer Node (e.g. 24) and Vercel agree on a supported runtime.

---

## 3. Frontend API URL & localhost usage

| Location | Behavior |
|----------|----------|
| `client/src/lib/api.ts` | `API_BASE = import.meta.env.VITE_API_URL \|\| ''` + `credentials: 'include'` |
| `client/src/lib/apiList.ts` | Same |
| Track / shop-registration / ReportsCenter | Same `VITE_API_URL` pattern |
| `client/vite.config.ts` | Dev-only proxy `/api` + `/health` → `http://localhost:5000` |
| Playwright / E2E specs | Hardcoded `http://localhost:5000` (**tests only** — OK) |

Production on Vercel **must** set `VITE_API_URL` to the public API origin at **build time** (e.g. `https://api.example.com`). Empty `VITE_API_URL` assumes same-origin `/api`, which Vercel will not reverse-proxy to Express unless you add a separate rewrite to an external API (possible later; not required for Phase 2).

CSP `connect-src` already includes `VITE_API_URL` / `PUBLIC_API_URL` from `svelte.config.js`.

---

## 4. Auth cookies, CORS, CSRF, refresh (cross-origin)

| Mechanism | Implementation | Vercel implication |
|-----------|----------------|--------------------|
| Access / refresh | HttpOnly `rc_access` / `rc_refresh` | Set by **API** host, not Vercel |
| CSRF | Readable `rc_csrf` + `X-CSRF-Token` | Must remain readable on API responses; JS reads cookie for API origin |
| CORS | Allowlist `CLIENT_URL` (+ optional `CLIENT_URL_ALT`), `credentials: true` | Set `CLIENT_URL` to exact Vercel URL (`https://….vercel.app` or custom) |
| Refresh | `POST /api/v1/auth/refresh` with credentials + CSRF | Works cross-origin if cookies + CORS correct |
| SameSite | Default `lax` | **Cross-site** (vercel.app ↔ unrelated API domain) requires `COOKIE_SAME_SITE=none` (forces Secure) |
| Optional `COOKIE_DOMAIN` | Shared parent e.g. `.example.com` | Only when using sibling custom domains |

**Required API env for split Vercel + API hosts:**

```env
CLIENT_URL=https://<your-vercel-app>
COOKIE_SAME_SITE=none
# COOKIE_DOMAIN=   # only if sibling custom domains under one parent
```

**Required Vercel build env (public, non-secret):**

```env
VITE_API_URL=https://<your-api-host>
```

Never expose `MONGODB_URI`, `JWT_SECRET`, or `PROVISIONING_API_KEY` as `VITE_*`.

---

## 5. Backend hosting requirements (unchanged)

| Requirement | Detail |
|-------------|--------|
| Runtime | Persistent Node 20+ process (`npm run build -w server` → `npm run start -w server`) |
| DB | Atlas with replica-set transactions (payments, outbox) |
| Health | `GET /health` → `dbMode: "atlas"` |
| Background work | In-process outbox `setInterval` — **incompatible with serverless** |
| Long-lived listen | `app.listen` — **not** a Vercel function |
| Filesystem | Only env loading / seed scripts locally; no prod disk dependency for API serving |
| Env | See `.env.example` / `DEPLOYMENT.md` |

---

## 6. Exact Vercel project settings (npm workspaces)

Recommended (Root Directory = `client`):

| Setting | Value |
|---------|--------|
| Framework Preset | SvelteKit |
| Root Directory | `client` |
| Install Command | `cd .. && npm ci` |
| Build Command | `npm run build` |
| Output | Managed by `@sveltejs/adapter-vercel` (do not set a static Output Directory) |
| Node.js Version | 20.x |
| Build env | `ADAPTER=vercel` (also set in `client/vercel.json`) + `VITE_API_URL` |

Alternative (Root Directory = repo root):

| Setting | Value |
|---------|--------|
| Root Directory | `.` (empty) |
| Install Command | `npm ci` |
| Build Command | `npm run build:vercel` (client adapt + promote to `.vercel/output`) |
| Framework | `null` (Build Output API via root `vercel.json`) |

`client/vercel.json` is authoritative when Root Directory = `client`.

---

## 7. Unsupported on Vercel (frontend-only scope)

| Assumption | Where | Vercel impact |
|------------|-------|---------------|
| Express `listen` + outbox timer | `server/src/index.ts` | Must stay off Vercel |
| Mongo multi-doc transactions | payments / outbox | Needs persistent Atlas-connected API |
| Vite `/api` proxy | `vite.config.ts` | Dev only; prod needs `VITE_API_URL` |
| adapter-node `client/build` | VPS path | Still used when `ADAPTER` ≠ vercel / not on Vercel |
| Writing local backup dumps | ops scripts | Not part of Vercel runtime |

Client `hooks.server.ts` only sets security headers — compatible with adapter-vercel.

No client `+page.server` loaders found that call the Express API — browser `fetch` paths dominate, which simplifies split hosting.

---

## Phase 2 preparation (approved by this plan)

1. Add `@sveltejs/adapter-vercel`; select adapter via `VERCEL` / `ADAPTER`.
2. Keep `@sveltejs/adapter-node` for VPS builds.
3. Add `client/vercel.json` + update `.env.example` / `DEPLOYMENT.md`.
4. Do **not** move Express or Atlas.
5. Do **not** hardcode production URLs or secrets.

---

## EPERM resolution (2026-11-09)

### Exact root cause

1. Vite/SvelteKit compilation succeeds.
2. Failure is in `@sveltejs/adapter-vercel` **after** compile, at `fs.symlinkSync(...)` when creating Build Output API route observability links (e.g. `functions/index.func` → `![-].func`). Source: `node_modules/@sveltejs/adapter-vercel/index.js` (~line 479).
3. This Windows host **cannot create symlinks** without elevation: probe returned `Administrator privilege required` / missing `SeCreateSymbolicLinkPrivilege` (Developer Mode off).
4. Therefore local `ADAPTER=vercel` / anonymous `vercel deploy --temporary` (CLI 65 builds locally first) both die with `EPERM`. **Not** a SvelteKit/app config bug; **not** fixed by switching back to adapter-node on Vercel.

### Versions inspected

| Package | Version |
|---------|---------|
| Node (local) | v24.18.0 |
| npm | 11.16.0 |
| `@sveltejs/kit` | 2.70.4 |
| `vite` | 6.4.5 |
| `svelte` | 5.57.3 |
| `@sveltejs/adapter-vercel` | 5.10.3 |
| `@sveltejs/adapter-node` | 5.5.8 |
| Target Vercel runtime | `nodejs20.x` (pinned in adapter options) |
| Client `engines.node` | `20.x` |

### Configuration changes (production-safe)

| File | Change |
|------|--------|
| `client/svelte.config.js` | `useVercel = Boolean(process.env.VERCEL) \|\| ADAPTER===vercel` — **VERCEL always wins** (ADAPTER=node cannot select adapter-node on Vercel) |
| `client/vercel.json` | `installCommand: cd .. && npm ci`, `build.env.ADAPTER=vercel` |
| `vercel.json` (repo root) | Optional monorepo-root path: `npm run build:vercel` |
| `scripts/promote-vercel-output.mjs` | Copies `client/.vercel/output` → `.vercel/output` for root projects |
| `package.json` | `build:vercel` script |
| `.github/workflows/vercel-client-build.yml` | Ubuntu Node 20 build + artifact + secret scan |
| `.vercelignore` | Keeps secrets/build junk out of uploads |

VPS `adapter-node` path preserved (default when `VERCEL` unset).

### Adapter selection proof (logic)

```
VERCEL=1 ADAPTER=node  → vercel   (cannot accidentally ship adapter-node)
(default)              → node
ADAPTER=vercel         → vercel
```

### Successful Vercel / Linux build evidence

| Attempt | Result |
|---------|--------|
| Local Windows `ADAPTER=vercel` adapt | **FAIL** `EPERM` (expected on this host) |
| Anonymous `vercel deploy --temporary` | **FAIL** same host symlink EPERM (CLI builds locally when logged out) |
| Docker / WSL Linux | **Unavailable** on this machine (not installed; WSL install blocked as host change) |
| GitHub Actions Ubuntu workflow | **Added** — run after the repo is on GitHub (`workflow_dispatch`) for authoritative Linux evidence |
| Logged-in Vercel remote builder | **Pending** — requires `vercel login` + project link |

**Do not treat Vite compile success as a successful Vercel build.** Linux evidence is still required via the workflow or a logged-in Vercel deployment.

### Remaining deployment blockers

1. **Linux build proof** — push/run `.github/workflows/vercel-client-build.yml` or `vercel login` then deploy so builders run on Linux.
2. **Persistent Express API host** + Atlas still required (not on Vercel).
3. Set real `VITE_API_URL` / API `CLIENT_URL` + `COOKIE_SAME_SITE=none` for cross-site cookies.
4. Optional: enable Windows Developer Mode only if you need local adapter-vercel smoke — does not change production config.
