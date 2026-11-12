# Supplier Network Phase 4 — Plan

## Boundaries
- No changes to customer PaymentRecord / repair revenue.
- Shop inventory via existing Part + InventoryMovement (session-aware stock-in).
- Phase 3 RFQ/quotation acceptance unchanged; PO is a separate post-accept action.
- No payment gateway.

## Slices
1. Models: PurchaseOrder, SupplierShipment, GoodsReceipt, SupplierLedgerEntry
2. Services: PO lifecycle, shipments, GRN+inventory txn, ledger, reports
3. Routes + zod + rate limits under `/api/v1/supplier-network`
4. UI: admin/supplier POs, GRN, finance, A4 print
5. Vitest Phase 4 + full suite + tsc + client build + Playwright

## Auth
- PO create/issue/cancel/amend: shop_admin
- Receiving (GRN): shop_admin | parts_coordinator
- Supplier: own POs/shipments/invoices only
