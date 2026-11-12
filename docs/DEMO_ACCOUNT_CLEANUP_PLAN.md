# Demo Account Cleanup Plan

**Status:** Plan only — **no deletions executed** in Phase 2.  
**Approval required** before `--execute`.  
**Inventory refreshed:** 2026-11-11 (`npm run demo:list -w server`, read-only).

## 1. Confirmed demo / seed identities

| Email | Role | Source |
|-------|------|--------|
| `customer@repairconnect.local` | customer | `seedData.ts` |
| `mechanic@repairconnect.local` | mechanic | seed |
| `mechanic.khi@repairconnect.local` | mechanic | seed (shop B) |
| `parts@repairconnect.local` | parts_coordinator | seed |
| `admin@repairconnect.local` | shop_admin | seed |
| `supplier@repairconnect.local` | supplier | provisioned for Porto/E2E |
| `p4.e2e.ops@repairconnect.local` | platform_operator | Phase 4 e2e |
| `lhr@repairconnect.local` | shop contact email | Lahore shop |
| `khi@repairconnect.local` | shop contact email | Karachi shop |
| `customer-b-*@repairconnect.local` (×11) | customer | UX account-switch / E2E |

Default demo password used in docs/tests: `Password123!` — **must be rotated or accounts removed** before production traffic.

### Inventory snapshot (read-only, 2026-11-11)

Command: `npm run demo:list -w server` against configured Atlas (`deleted: false`).

| Class | Count / detail |
|-------|----------------|
| Demo users (`*@repairconnect.local`) | **18** (5 seed roles + supplier + ops + 11 `customer-b-*`) |
| Demo shops | **2** — `LHR01` Lahore Tech Repair, `KHI01` Karachi Device Hub |
| Demo supplier business | **1** — `SUP-B087B4C3B2A3` “Porto Demo Supplier Hub” (`supplier@repairconnect.local`) |

| Dependency counts | |
|-------------------|--|
| memberships | 24 |
| repairs | 79 |
| parts | 7 |
| appointments | 1 |
| payments (demo shops) | 27 |
| purchase orders (demo shops / demo supplier) | 35 |
| goods receipts | 34 |
| supplier ledger entries | 69 |
| supplier reviews | 14 |
| distinct E2E supplier businesses via demo-shop POs | 26 |
| demo supplier catalog items | 0 |

## 2. Associated data (dependencies)

- `ShopMembership` for demo users / demo shops  
- `RepairRequest` / payments / appointments for demo shops or customers  
- `Part` stock for demo shops  
- Supplier network: POs, GRNs, ledger, reviews tied to demo shops or the demo supplier business  
- Ephemeral E2E actors: `*@example.com`, `*@repairconnect.test`, and many `SUP-*` businesses created by Playwright — **not** `@repairconnect.local`; review separately  

**Retention:** Keep Atlas snapshot before any wipe. Financial rows (payments, GRNs, ledger) on demo shops are test history — archive or delete only with written approval.

## 3. Pre-deletion checklist

1. Confirm target database is **not** a live customer-bearing production DB, **or** maintenance window approved.  
2. Run inventory: `npm run demo:list -w server`  
3. Export inventory JSON into the change ticket.  
4. Ensure Atlas Cloud Backup / snapshot exists from the last 24h (**currently UNVERIFIED** — see release audit).  
5. Obtain explicit written approval: “Delete demo accounts per DEMO_ACCOUNT_CLEANUP_PLAN”.

## 4. Deletion procedure (after approval)

```bash
# Dry-run (always first)
npm run demo:cleanup -w server

# Execute on staging / approved maintenance only:
CLEANUP_CONFIRM=DELETE_DEMO_ACCOUNTS npm run demo:cleanup -w server -- --execute

# Production additionally requires:
# CLEANUP_ALLOW_PRODUCTION=YES CLEANUP_CONFIRM=DELETE_DEMO_ACCOUNTS \
#   npm run demo:cleanup -w server -- --execute
```

## 5. Secret rotation (parallel track)

| Secret | Action |
|--------|--------|
| Demo user passwords | Delete accounts preferred; else change password hashes |
| `JWT_SECRET` | Rotate if ever used with demo/public envs |
| `PROVISIONING_API_KEY` | Rotate before go-live |
| Atlas DB user password | Rotate if shared with laptops/CI logs |

## 6. Verification after cleanup

```bash
npm run demo:list -w server
# Expect demoUsers: [] and demoShops: []

# Login with customer@repairconnect.local must fail
```

## 7. Approval log

| Date | Approver | Environment | Result |
|------|----------|-------------|--------|
| _pending_ | | | Not executed |
