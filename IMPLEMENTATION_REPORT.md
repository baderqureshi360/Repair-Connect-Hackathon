# RepairConnect — Enhancement Implementation Report

Enhancement of the existing SaaS application (not a rebuild). Auth, CSRF, multi-shop isolation, atomic inventory reservation, and the premium dashboard shell are preserved.

## Completed features

### Phase 1 — Public marketing website
- `/` is a full marketing site (hero, features, how-it-works, roles, accessibility, CTA, footer).
- Public routes: `/login`, `/register` (customer-only), `/forgot-password`, `/privacy`, `/terms`, `/accessibility`.
- Authenticated visitors keep the public site and can open their portal via CTA.
- Private portals remain under `/app/*` after authentication.

### Phase 2 — Inventory workspace
- Dedicated Inventory nav → `/app/parts/inventory`.
- Overview KPIs, search/filter/sort, create/edit/deactivate, stock-in, adjust, movements, pending requests.
- Shop-scoped via `shopQuery` / selected shop; atomic reservation APIs unchanged.

### Phase 3 — Shop management
- `/app/admin/shops` for authorized shop admins (create/edit/activate/archive-check/archive).
- Soft archive with blocker checks (active repairs, appointments, reservations, transfers, etc.).
- Shop selector uses `/api/v1/shops/mine` and refreshes scoped data on switch.

### Phase 4 — Reports center
- Role-specific `/app/*/reports` pages backed by `GET /api/v1/reports/center` (+ CSV).
- Categories: repairs, financial, inventory, mechanics, customers — role-gated on the server.
- Financial revenue uses **PaymentRecord** amounts only (not completed `finalCost`).

### Phase 5 — Repair receipts
- Completed repairs: Print Repair Receipt / Preview / Download → issued invoice snapshots.
- Itemized labor, parts, additional services; tax, discount, paid, balance, payment status.
- Document viewer supports A4, 80mm, 58mm, print/PDF, EN/UR + RTL.
- Snapshots are immutable at issue time; shop-admin payment recording UI added.

### Phase 6 — Fullscreen
- Header fullscreen toggle using the Fullscreen API, `fullscreenchange` sync, Escape exit, graceful unsupported handling.

### Phase 7 — Navigation
- Role-scoped sidebar: Dashboard, Appointments, Repairs, Customers, Inventory, Shop Management, Reports, Documents, Notifications, Settings (as applicable).
- Backend permission checks remain authoritative.

### Phase 8–9 — UX / security
- Marketing + app responsive layouts; EN/UR RTL; keyboard/axe checks on portals.
- Cookie JWT + CSRF retained; shopId/userId never trusted from the client alone.
- Swagger updated for forgot-password, shops mine/archive, reports center, documents issue/payments.
- Optional schema additions reused existing models where possible (`PasswordReset`, shop archive fields).

## Verification (executed)

| Check | Result |
|-------|--------|
| Server Vitest | **41/41 passed** |
| Playwright e2e (incl. marketing + a11y) | **14/14 passed** |
| Server `tsc` production build | **passed** |
| Client Vite production build | **passed** |
| MongoDB Atlas `verify:atlas` | **ATLAS_VERIFY_PASSED** (persistence + concurrent reservation) |

## Limitations

- No separate organization/platform-admin role; shop_admin is the top shop lifecycle authority in this deployment.
- Forgot-password is non-enumerating; reset token delivery is environment-dependent (token surfaced only in non-production responses when email is not configured).
- Inventory list API continues to return active parts; deactivate is soft (`DELETE` → `isActive: false`).
- Physical device AT audit still recommended beyond axe-core.
- Public deploy was **not** performed (requires explicit authorization).

## How to run

```bash
cp .env.example .env
npm install
npm run dev
```

- App: http://localhost:5173  
- API: http://localhost:5000  
- Swagger: http://localhost:5000/api/docs  
