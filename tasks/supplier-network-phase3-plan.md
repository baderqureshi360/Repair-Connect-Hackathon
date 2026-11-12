# Supplier Network Phase 3 Plan

## Scope
Shop–supplier messaging, RFQ distribution, quotation submit/revise/withdraw, comparison UI, selective acceptance. No POs/payments/receiving.

## Models
- `SupplierConversation` + `SupplierConversationMessage` (participant_visible | shop_internal)
- `SupplierRfq` + embedded items/recipients
- `SupplierQuotation` + line items / alternatives

## Auth
- Shop: membership via `req.user.shopIds`
- Supplier: `SupplierBusiness.owner === user.id`
- Never expose shop_internal messages to suppliers

## API prefixes
- `/api/v1/supplier-network/conversations`
- `/api/v1/supplier-network/rfqs`
- `/api/v1/supplier-network/quotations`
