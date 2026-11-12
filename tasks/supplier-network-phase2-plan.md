# Supplier Network Phase 2 Plan

## Overview
Extend Phase 1 `SupplierCatalogItem` with full listing fields, supplier-owned stock + movement history, and marketplace product discovery — without touching shop inventory.

## Assumptions
1. Soft-archive via `archivedAt` / `isArchived` (no hard delete for irreversible archive; hard delete stays confirmation-gated for empty drafts only, or replace delete with archive).
2. Availability status: `in_stock | low_stock | out_of_stock | discontinued` derived from qty unless explicitly discontinued.
3. Low-stock threshold default = 5 (overridable per item).
4. Concurrent stock: optimistic `expectedQuantity` + conditional `findOneAndUpdate`.
5. Marketplace gains product listing search alongside supplier cards.

## Slices
1. Model + indexes
2. Portal catalog/stock services + APIs
3. Marketplace product search API
4. Supplier + shop admin UI
5. Tests + builds
