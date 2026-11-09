# RepairConnect

Accessible multi-shop repair network connecting customers, mechanics, shop admins, and parts coordinators.

Unauthenticated visitors land on the public marketing site (`/`). Authenticated users open role portals under `/app/*` after sign-in.

## Stack

- **Frontend:** SvelteKit + TypeScript + Tailwind CSS
- **Backend:** Node.js + Express + Zod
- **Database:** MongoDB (Atlas via `MONGODB_URI`, or in-memory replica set for local/dev)
- **Auth:** HttpOnly JWT cookies + CSRF; staff via invitation/provisioning only
- **Docs:** Swagger UI at `/api/docs`
- **Tests:** Vitest (API) + Playwright (UI/a11y)

## Quick start

```bash
cp .env.example .env
# Local demo (explicit only — no silent fallback):
#   USE_MEMORY_DB=true
# Persistent Atlas:
#   MONGODB_URI=mongodb+srv://USER:PASS@cluster.mongodb.net/?retryWrites=true&w=majority
#   USE_MEMORY_DB=false
#   JWT_SECRET=<32+ char secret>
# Production forbids empty MONGODB_URI, USE_MEMORY_DB, and SEED_ON_START.

npm install
npm run dev
# Against Atlas (optional): npm run seed -w server && npm run verify:atlas -w server
```

- App: http://localhost:5173  
- API: http://localhost:5000  
- Swagger: http://localhost:5000/api/docs  

### Seed accounts (password: `Password123!`)

| Role | Email |
|------|-------|
| Customer | `customer@repairconnect.local` |
| Mechanic | `mechanic@repairconnect.local` |
| Parts coordinator | `parts@repairconnect.local` |
| Shop admin | `admin@repairconnect.local` |

## MongoDB Atlas

1. Create a free Atlas cluster and database user.
2. Allow network access for your IP (or `0.0.0.0/0` for demos).
3. Set `MONGODB_URI` in `.env` and remove/disable `USE_MEMORY_DB`.
4. Database name: `repairconnect`.
5. Run `npm run seed -w server`.

Never commit real credentials. `.env` is gitignored.

## Acceptance workflow

1. Customer submits a laptop repair.
2. Shop admin assigns a mechanic.
3. Mechanic diagnoses and submits an estimate.
4. Customer approves.
5. Mechanic requests a screen part (initially out of stock).
6. Parts coordinator sees shortage; records stock arrival; reserves stock.
7. Mechanic completes the repair; customer gets a completion notification.

## Tests

```bash
npm run test -w server
npm run test:e2e -w client
```

## Application map

| Area | Route / API |
|------|-------------|
| Public marketing | `/` |
| Sign in / register / forgot password | `/login`, `/register`, `/forgot-password` |
| Role portals | `/app/customer`, `/app/mechanic`, `/app/parts`, `/app/admin` |
| Inventory workspace | `/app/parts/inventory` |
| Shop management | `/app/admin/shops` |
| Reports center | `/app/*/reports` → `GET /api/v1/reports/center` |
| Documents / print (A4, 80mm, 58mm) | `/app/documents/:id` |
| Fullscreen | Header toggle (Fullscreen API) |

## Project layout

```
client/   SvelteKit UI (marketing site, EN/UR + RTL, light/dark, role portals)
server/   Express API, Mongoose models, Swagger, Vitest
```

Do not deploy publicly without explicit authorization.
