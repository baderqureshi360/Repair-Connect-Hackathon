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
| Node.js | 20.x |

### Frontend environment

| Variable | When | Value |
|----------|------|--------|
| `ADAPTER` | build | `vercel` (also set in `client/vercel.json`) |
| `VITE_API_URL` | **build** | `https://<backend-project>.vercel.app` (no trailing slash) |
| `PUBLIC_SENTRY_DSN` | optional | Browser DSN only |

Never set `MONGODB_URI` / `JWT_SECRET` / `CRON_SECRET` as `VITE_*`.

---

## Project B — Backend (`server`)

| Setting | Value |
|---------|--------|
| Root Directory | `server` |
| Framework | Express |
| Install Command | `cd .. && npm ci` |
| Build Command | `npm run build` |
| Entry | `src/index.ts` / `src/server.ts` — **`export default app`** (no `listen` on Vercel) |
| Node.js | 20.x |
| Cron | `POST /api/cron/outbox` every 5 minutes (`server/vercel.json`) — confirm plan allows schedule |

### Backend environment

| Variable | Required | Notes |
|----------|----------|--------|
| `NODE_ENV` | yes | `production` |
| `MONGODB_URI` | yes | Atlas URI |
| `USE_MEMORY_DB` | yes | `false` |
| `JWT_SECRET` | yes | ≥ 32 chars |
| `CLIENT_URL` | yes | Exact frontend origin `https://….vercel.app` |
| `COOKIE_SECURE` | yes | `true` |
| `COOKIE_SAME_SITE` | yes | **`none`** for split vercel.app hosts |
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

## Auth checklist (split origins)

1. Frontend build embeds `VITE_API_URL` → API host.
2. Backend `CLIENT_URL` matches frontend origin exactly.
3. `COOKIE_SAME_SITE=none` + `COOKIE_SECURE=true`.
4. Browser: API host cookies `HttpOnly` + `Secure` + `SameSite=None`.
5. Login JSON still provides `csrfToken` for cross-site header use.

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
