# Staff Management — Implementation & Verification Report

## Summary

Complete Shop Admin **Staff Management** module delivered at `/app/admin/staff`, reusing existing auth cookies, `ShopMembership`, role checks, and audit logging. No new authentication system, schema changes, or repair/payment/inventory logic changes.

## What was implemented

### Backend (`server/src/services/staff.ts` + `routes/auth.ts`)

| Endpoint | Purpose |
|----------|---------|
| `GET /api/v1/auth/staff` | List staff (array by default; `?view=manage&includeInactive=1` → `{ staff, stats }`) |
| `POST /api/v1/auth/staff` | Create mechanic / parts_coordinator / shop_admin in authorized shop |
| `GET /api/v1/auth/staff/:membershipId` | Staff detail |
| `PATCH /api/v1/auth/staff/:membershipId` | Edit name, phone, role, shop |
| `POST /api/v1/auth/staff/:membershipId/status` | Soft activate / deactivate |
| `POST /api/v1/auth/staff/:membershipId/reset-password` | Temporary password + optional invite token |

### Security controls

- Shop Admin only (`requireRoles('shop_admin')` + server-side `shopIds` checks)
- Roles limited to operational staff; `platform_operator` / `customer` rejected
- Cross-shop assignment denied
- Duplicate email → `409 DUPLICATE`
- Soft deactivation (membership + user `isActive`); no deletes; repair references preserved
- Last Shop Admin / self-deactivate / self-demotion blocked
- Audit actions: `auth.staff_create|update|activate|deactivate|password_reset`

### Frontend

- Sidebar label: **Staff Management** (`/app/admin/staff`) — already routed; UI replaced
- KPI stats, searchable/filterable table, add/edit/view modals, activate/deactivate, password reset
- EN/UR translations
- Non–shop-admin visitors redirected away from the page
- Parts Coordinator creation uses existing role; login still maps to `/app/parts`

## Verification

| Check | Result |
|-------|--------|
| Server tests (full suite) | **98/98 passed** (includes new `staff-management.test.ts`, 10 cases) |
| Server `tsc --noEmit` | **Passed** |
| Client production build | **Passed** |
| Playwright `staff-management.spec.ts` | **2/2 passed** |
| Playwright `portals.a11y.spec.ts` (incl. admin staff) | **Passed** (run with staff suite earlier: 5 a11y + related passed) |

### Test coverage mapped to requirements

1. Shop Admin creates mechanic — covered  
2. Shop Admin creates Parts Coordinator + login role — covered  
3. Portal redirection (PC → `/app/parts`) — Playwright  
4. Edit + deactivate — covered  
5. Unauthorized cross-shop — covered  
6. Customer/mechanic denial — covered  
7. `platform_operator` escalation blocked — covered  
8. Last/self Shop Admin protection — covered  
9. Repair records intact after deactivation — covered  

## Assumptions

1. Extended existing `/api/v1/auth/staff` contract (not a new `/api/v1/staff` mount) to avoid breaking callers.  
2. Soft deactivation sets membership inactive and user inactive when no other active memberships remain.  
3. Create still requires an initial password; optional `invite` creates a password-reset token.  
4. Default `GET /staff` remains an array for repair-assignment compatibility; manage UI uses `?view=manage`.
