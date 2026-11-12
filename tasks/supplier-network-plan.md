# Implementation Plan: Supplier Network Phase 1

## Overview

Introduce an independent `supplier` role with business registration, Platform Operator verification/approval, supplier profiles + catalog, and city-based marketplace discovery for Shop Admins — mirroring shop-owner onboarding without granting platform privileges.

## Assumptions

1. Existing shop-scoped inventory `Supplier` model/routes (`/api/v1/suppliers`, `/app/parts/suppliers`) stay untouched.
2. New domain uses `SupplierBusiness`, `SupplierApplication`, `SupplierCatalogItem`, `SupplierReview`.
3. Marketplace APIs live under `/api/v1/marketplace/suppliers` (no collision with inventory suppliers).
4. Province maps to `region` (same as shops).
5. Logo + verification docs stored as bounded data URLs (same pattern as `avatarUrl`).
6. Spare-part categories are a new constant list (not shop `SERVICE_CATEGORIES`).
7. Genuine rating shown only when ≥ 3 reviews exist; Phase 1 ships review aggregation + optional shop-admin review create.
8. Pending suppliers use `accountStatus: pending_supplier` and status page `/app/supplier-application/status`; approved login goes to `/app/supplier`.

## Architecture Decisions

- Mirror `ShopApplication` + `registerShopOwnerApplication` / platform approve-reject flows.
- Supplier is an independent business account (User.role=`supplier`), not a ShopMembership.
- Marketplace visibility: `status === 'approved' && isActive && deliveryCities includes city`.
- Suspend sets `isActive=false` (and optional `status=suspended`); excluded from marketplace.

## Task List

### Phase A: Foundation
- Task 1: Role + account status + spare-part categories
- Task 2: Models (application, business, catalog, review)
- Task 3: Registration service + public API + validation

### Phase B: Operator + supplier portal
- Task 4: Platform supplier-applications API + UI (list/detail/approve/reject/suspend/reactivate)
- Task 5: Supplier portal routes + basic dashboard/profile/catalog CRUD
- Task 6: Pending status page + login/layout redirects

### Phase C: Marketplace
- Task 7: Marketplace search/filter API for shop_admin
- Task 8: `/app/admin/suppliers` + profile page UI
- Task 9: Nav, i18n, swagger, Vitest coverage

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Name collision with inventory Supplier | High | Separate models + `/marketplace` routes |
| Pending account API leak | High | Extend auth allowlist like shop owners |
| Large data-URL docs | Med | Cap size in zod schemas |

## Open Questions

None blocking — proceed with assumptions above.
