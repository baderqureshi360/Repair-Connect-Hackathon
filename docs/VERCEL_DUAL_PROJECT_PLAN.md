# RepairConnect — Vercel Dual-Project Implementation Plan

**Date:** 2026-11-11  
**Status:** Plan + controlled implementation. Live Vercel deploy **not** claimed.  
**Repos:** Existing MongoDB Atlas only. No FerretDB. No business-logic rewrite.

---

## ASSUMPTIONS

1. Two Vercel projects share one GitHub repo: **Frontend** Root Directory = `client`, **Backend** Root Directory = `server`.
2. Origins differ (`*.vercel.app` × 2) unless later custom sibling domains are added → cross-site cookies require `COOKIE_SAME_SITE=none` + HTTPS.
3. Enzonic / adapter-node single-process path remains available (`ADAPTER=node`, `SERVE_WEB`).
4. Secrets stay in Vercel project env — never in Git.

---

## Current architecture (inspected)

| Piece | State |
|-------|--------|
| Client adapter | `adapter-vercel` when `VERCEL=1` or `ADAPTER=vercel`; else `adapter-node` |
| `client/vercel.json` | Present (`installCommand: cd .. && npm ci`) |
| Root `vercel.json` | Optional root Build Output path via `build:vercel` |
| Server | `createApp()` + `index.ts` listen + outbox `setInterval` + optional SvelteKit mount |
| Auth | HttpOnly `rc_access`/`rc_refresh`, readable `rc_csrf`, CORS allowlist, refresh rotation |
| DB | `connectDb()` already reuses `mongoose.connection.readyState === 1` |
| Uploads / PDFs | Mongo strings + browser print — no disk dependency |
| WebSockets | None (notification polling only) |

---

## Deployment blockers

| ID | Severity | Issue | Mitigation in this work |
|----|----------|--------|-------------------------|
| B1 | **Hard** | In-process outbox `setInterval` does not run reliably on serverless idle instances | Disable interval when `VERCEL=1`; keep `kickOutboxProcessor` on writes; add **`POST /api/cron/outbox`** + Vercel Cron + `CRON_SECRET` |
| B2 | **Hard** | Hobby Cron may be ≤1/day → delayed notifications when idle | Document; rely on request-time kicks for demo traffic; upgrade Cron plan if near-realtime required |
| B3 | **Hard** | Local Windows `adapter-vercel` often fails `EPERM` (symlinks) | Build/verify on Vercel Linux builders or CI; do not treat local adapt as proof |
| B4 | Medium | In-memory `express-rate-limit` is per-instance | Keep behavior; document multi-instance weakness (no security removal) |
| B5 | Medium | Cold starts + Atlas IP allowlist | Ensure Atlas allows Vercel egress (often `0.0.0.0/0` for serverless) |
| B6 | Medium | Bundle size / `mongodb-memory-server` in server deps | Build tracing; memory server only for tests — watch function size |
| B7 | Low | Swagger UI on serverless | Keep route; may be slow/cold — acceptable |

**Non-blockers (compatible):** API routes, CSRF/CORS/cookies (with `SameSite=None`), tenant isolation, payments transactions on Atlas, base64 photo URLs, print/PDF in browser.

---

## Target design

```
Browser (Vercel SvelteKit)
   │  VITE_API_URL=https://<api>.vercel.app
   │  credentials: include
   ▼
Express on Vercel (single Fluid function)
   │  export default app (no listen on Vercel)
   │  ensure Mongo connected (reuse)
   │  COOKIE_SAME_SITE=none, CLIENT_URL=<frontend origin>
   ▼
MongoDB Atlas
```

---

## Phased implementation

### Phase A — Docs/plan (this file)

### Phase B — Serverless Express entry
- Export Express app for Vercel without requiring a second server.
- Gate `app.listen` + outbox interval + SvelteKit mount to non-Vercel.
- Add DB-ready middleware for cold start.
- Add secured outbox cron route.

### Phase C — Vercel project config
- `server/vercel.json` (install from monorepo root, Express, cron).
- Confirm `client/vercel.json`.
- Dual-project env documentation.

### Phase D — Tests
- CORS credentialed allowlist / reject unknown origin.
- Cookie SameSite=none production config path.
- CSRF still on API; cron auth; health; isolation suite still green.

### Phase E — Run Vitest (and note Playwright / live deploy as NOT VERIFIED)

---

## Exact Vercel Dashboard settings

### Project 1 — Frontend

| Setting | Value |
|---------|--------|
| Root Directory | `client` |
| Framework | SvelteKit |
| Install | `cd .. && npm ci` |
| Build | `npm run build` |
| Node | 20.x |
| Env (build) | `ADAPTER=vercel`, `VITE_API_URL=https://<backend-project>.vercel.app` |

### Project 2 — Backend

| Setting | Value |
|---------|--------|
| Root Directory | `server` |
| Framework | Express (or Other) |
| Install | `cd .. && npm ci` |
| Build | `npm run build` |
| Node | 20.x |
| Env (runtime) | See `.env.production.example` + `COOKIE_SAME_SITE=none`, `CLIENT_URL=<frontend>`, `CRON_SECRET`, `MONGODB_URI`, `JWT_SECRET` |

---

## Explicit non-goals

- No schema / auth architecture / tenant rule changes.
- No FerretDB.
- No feature removal to “fit” serverless.
- No claim of production deploy success without Dashboard verification.
