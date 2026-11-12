# RepairConnect — Enzonic single-process deploy

**Status:** Implementation ready. Live Enzonic deploy **not** performed by this document.

One Node process serves Express API + SvelteKit (`@sveltejs/adapter-node` handler) on one HTTPS origin.

## Architecture

1. `npm run build` → `server/dist` + `client/build` (including `handler.js`).
2. `npm start` → `node server/dist/index.js`.
3. `index.ts` mounts `client/build/handler.js` **after** all API routes (unless `SERVE_WEB=false`).
4. Do **not** run adapter-node’s standalone `node client/build` as a second server.

## Commands

```bash
# Production build (same-origin: leave VITE_API_URL unset)
npm ci
npm run build
# equivalent: npm run build:single

# Start (binds HOST=0.0.0.0, PORT from platform)
SERVE_WEB=true npm start
```

## Environment

See `.env.production.example`. Required for Enzonic always-on Node:

| Variable | Value |
|----------|--------|
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` |
| `PORT` | Platform-assigned |
| `MONGODB_URI` | Atlas URI |
| `USE_MEMORY_DB` | `false` |
| `JWT_SECRET` | ≥ 32 chars |
| `CLIENT_URL` | Exact public HTTPS origin |
| `COOKIE_SECURE` | `true` |
| `COOKIE_SAME_SITE` | `lax` |
| `COOKIE_DOMAIN` | unset |
| `SERVE_WEB` | `true` |
| `SEED_ON_START` | `false` |
| `ALLOW_DEMO_LOGIN` | `false` |
| `VITE_API_URL` | **unset** at frontend build |
| `PROTOCOL_HEADER` | `x-forwarded-proto` (if TLS terminated upstream) |
| `HOST_HEADER` | `x-forwarded-host` (if TLS terminated upstream) |

Never commit real secrets.

## Smoke after start

```bash
curl -sS http://127.0.0.1:$PORT/health
curl -sS http://127.0.0.1:$PORT/ready
curl -sS -o /dev/null -w "%{http_code}" http://127.0.0.1:$PORT/
```

Login via UI on the same origin; cookies should be `HttpOnly` + `Secure` + `SameSite=Lax` on HTTPS.
