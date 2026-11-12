# RepairConnect — Vercel Dual-Project Deployment Guide

**Live deploy:** not performed by this document.  
**Plan / blockers:** `docs/VERCEL_DUAL_PROJECT_PLAN.md`

Two Vercel projects, one GitHub repository, existing MongoDB Atlas.

---

## Project A — Frontend (`client`)

| Setting | Value |
|---------|--------|
| Root Directory | `client` |
| Framework | SvelteKit |
| Install Command | `cd .. && npm ci` |
| Build Command | `npm run build` |
| Output | Managed by `@sveltejs/adapter-vercel` |
| Node.js | 26.x |

### Frontend environment

| Variable | When | Value |
|----------|------|--------|
| `ADAPTER` | build | `vercel` (also set in `client/vercel.json`) |
| `VITE_API_URL` | **build** | **Leave unset/empty** so the browser uses same-origin `/api/*` |
| `API_PROXY_TARGET` | **runtime** (server-only) | `https://<backend-project>.vercel.app` (no trailing slash) |
| `PUBLIC_SENTRY_DSN` | optional | Browser DSN only |

Never set `MONGODB_URI` / `JWT_SECRET` / `CRON_SECRET` as `VITE_*`.

> **Why empty `VITE_API_URL`?** `*.vercel.app` is a public suffix. Two Vercel projects are cross-site; browsers may block third-party auth cookies even with `SameSite=None`. The SvelteKit `/api/[...path]` route proxies to `API_PROXY_TARGET` so cookies are first-party on the frontend host.

---

## Project B — Backend (`server`)

| Setting | Value |
|---------|--------|
| Root Directory | `server` |
| Framework | Express |
| Install Command | `cd .. && npm ci` |
| Build Command | `npm run build` |
| Entry | `src/index.ts` / `src/server.ts` — **`export default app`** (no `listen` on Vercel) |
| Node.js | 26.x |
| Cron | `POST /api/cron/outbox` — Hobby may require manual/on-demand drain; see plan blockers |

### Backend environment

| Variable | Required | Notes |
|----------|----------|--------|
| `NODE_ENV` | yes | `production` |
| `MONGODB_URI` | yes | Atlas URI |
| `USE_MEMORY_DB` | yes | `false` |
| `JWT_SECRET` | yes | ≥ 32 chars |
| `CLIENT_URL` | yes | Exact frontend origin `https://….vercel.app` |
| `COOKIE_SECURE` | yes | `true` |
| `COOKIE_SAME_SITE` | yes | Prefer **`lax`** when frontend uses same-origin `/api` proxy; use **`none`** if the browser calls the API host directly |
| `COOKIE_DOMAIN` | no | unset unless sibling custom domains |
| `CRON_SECRET` | yes for cron | Bearer token for `/api/cron/outbox` |
| `SEED_ON_START` | no | must be unset/`false` |
| `ALLOW_DEMO_LOGIN` | no | must be unset/`false` |
| `SENTRY_DSN` | optional | |

Atlas Network Access must allow Vercel egress (often `0.0.0.0/0` for serverless).

---

## Outbox on serverless

| Mechanism | Role |
|-----------|------|
| `kickOutboxProcessor()` on writes | Primary drain while API receives traffic |
| `POST /api/cron/outbox` + `Authorization: Bearer $CRON_SECRET` | Backup drain when idle |
| `setInterval` outbox | **Disabled** when `VERCEL` is set |

Hobby Cron frequency limits may delay idle delivery — see plan blockers.

---

## Auth checklist (recommended: same-origin proxy)

1. Frontend **build**: `VITE_API_URL` unset/empty (clear build cache after changing).
2. Frontend **runtime**: `API_PROXY_TARGET=https://<backend>.vercel.app`.
3. Backend `CLIENT_URL` matches frontend origin exactly.
4. `COOKIE_SECURE=true`. Prefer `COOKIE_SAME_SITE=lax` with the proxy; `none` (+ Partitioned) remains for direct API calls.
5. DevTools → Application: cookies appear on the **frontend** host after login.
6. Login JSON still provides `csrfToken` (also readable from `rc_csrf` once first-party).

---

## Preserve Enzonic / single-process

Unset `VERCEL`. Use `ADAPTER=node`, empty `VITE_API_URL`, `SERVE_WEB=true`, `COOKIE_SAME_SITE=lax`. See `docs/ENZONIC_SINGLE_PROCESS.md`.

---

## Post-deploy smoke (manual)

```bash
curl -sS https://<api>/health
curl -sS https://<api>/ready
curl -sS -X POST https://<api>/api/cron/outbox -H "Authorization: Bearer $CRON_SECRET"
```

Open frontend → login → DevTools Network/Application cookie flags.
