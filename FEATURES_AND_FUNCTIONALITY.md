# RepairConnect — Complete Features & Functionality

**Product:** Accessible multi-shop repair network SaaS  
**Stack:** SvelteKit + TypeScript + Tailwind · Express + Zod · MongoDB Atlas  
**Auth:** HttpOnly JWT cookies + double-submit CSRF  
**Roles:** Customer · Mechanic · Parts Coordinator · Shop Admin  

This document catalogs every user-facing feature, role capability, workflow, API surface, and platform capability currently implemented in the monorepo.

---

## Table of contents

1. [Product overview](#1-product-overview)
2. [Roles & access model](#2-roles--access-model)
3. [Public marketing & legal](#3-public-marketing--legal)
4. [Authentication & account](#4-authentication--account)
5. [App shell & platform UX](#5-app-shell--platform-ux)
6. [Customer portal](#6-customer-portal)
7. [Mechanic portal](#7-mechanic-portal)
8. [Parts coordinator portal](#8-parts-coordinator-portal)
9. [Shop admin portal](#9-shop-admin-portal)
10. [Repair lifecycle](#10-repair-lifecycle)
11. [Appointments](#11-appointments)
12. [Inventory, suppliers & transfers](#12-inventory-suppliers--transfers)
13. [Documents, payments & printing](#13-documents-payments--printing)
14. [Analytics & reports](#14-analytics--reports)
15. [Notifications](#15-notifications)
16. [Appearance & preferences](#16-appearance--preferences)
17. [Internationalization & accessibility](#17-internationalization--accessibility)
18. [Security & multi-tenant isolation](#18-security--multi-tenant-isolation)
19. [API map](#19-api-map)
20. [Data models](#20-data-models)
21. [Route map (UI)](#21-route-map-ui)
22. [Out of scope / known limitations](#22-out-of-scope--known-limitations)

---

## 1. Product overview

RepairConnect connects four roles across one or more repair shops:

| Actor | Primary job |
|-------|-------------|
| **Customer** | Submit repairs, book appointments, approve estimates, track progress, give feedback, view receipts |
| **Mechanic** | Diagnose, estimate, request parts, complete work on assigned jobs |
| **Parts coordinator** | Manage inventory, fulfill parts requests, suppliers/restock, shop-to-shop transfers |
| **Shop admin** | Assign staff/jobs, manage shops & customers, settings, documents, payments, reports |

**Core acceptance flow**

1. Customer submits a laptop (or other device) repair.  
2. Shop admin assigns a mechanic.  
3. Mechanic diagnoses and submits an estimate.  
4. Customer approves (or rejects).  
5. Mechanic requests a part (may be out of stock).  
6. Parts coordinator records stock arrival and reserves stock atomically.  
7. Mechanic completes the repair; customer is notified and can collect / rate / print receipt.

---

## 2. Roles & access model

### Roles (`customer` | `mechanic` | `parts_coordinator` | `shop_admin`)

| Capability | Customer | Mechanic | Parts | Admin |
|------------|:--------:|:--------:|:-----:|:-----:|
| Self-register | ✓ | — | — | — |
| Staff provisioned by admin | — | ✓ | ✓ | ✓ |
| Own repairs only | ✓ | assigned only | shop-scoped | shop-scoped |
| Assign mechanic | — | — | — | ✓ |
| Diagnose / estimate | — | ✓ | — | ✓ |
| Approve / reject estimate | ✓ | — | — | — |
| Request / reserve parts | — | request | fulfill | both |
| Inventory CRUD | — | view | ✓ | ✓ |
| Suppliers / transfers | — | — | ✓ | ✓ |
| Shop create / archive | — | — | — | ✓ |
| Staff management | — | — | — | ✓ |
| Document settings / payments | limited issue | limited issue | payments | full |
| Reports (role-gated categories) | own | own | inventory/ops | all shop |

### Isolation rules (enforced server-side)

- Customers never see another customer’s repairs, appointments, receipts, or internal notes.  
- Mechanics only mutate/view **assigned** repairs (not shop-wide by ID).  
- Parts/inventory/staff scoped to member shops via `shopQuery` / membership.  
- Admin cannot manage staff or archive shops outside their memberships.  
- Public track endpoint strips PII and internal notes.  
- Profile update schema rejects role/shop escalation.  
- Client-supplied `shopId` / `userId` are never trusted alone.

---

## 3. Public marketing & legal

| Route | Functionality |
|-------|----------------|
| `/` | Full marketing site: hero, features, how-it-works, roles, accessibility, CTA, footer |
| `/login` | Sign-in |
| `/register` | Customer-only registration |
| `/forgot-password` | Non-enumerating password reset request |
| `/privacy` | Privacy policy |
| `/terms` | Terms of service |
| `/accessibility` | Accessibility statement |
| `/track/[token]` | Public repair status (no login; no customer PII) |

Authenticated users can still browse the public site and open their portal via CTA. Private portals live under `/app/*`.

---

## 4. Authentication & account

### Auth features

- **Register** (customer only) with name, email, password, optional language  
- **Login** / **Logout** with HttpOnly JWT access + refresh cookies  
- **CSRF** token endpoint + double-submit pattern on mutating requests  
- **Token refresh** without re-entering credentials  
- **Forgot password** (non-enumerating; token delivery env-dependent)  
- **Rate limiting** on auth endpoints  
- **Demo seed accounts** (dev only; blocked in production)  
- **Staff creation** by shop admin (invitation/provisioning — no public staff signup)

### Profile & security (`/app/profile`)

- View / update name, phone, preferred language  
- Change password  
- Notification preference toggles (in-app)  
- Strict schema: cannot change `role` or shop membership via profile API

### Seed demo accounts (password: `Password123!`)

| Role | Email |
|------|-------|
| Customer | `customer@repairconnect.local` |
| Mechanic | `mechanic@repairconnect.local` |
| Parts coordinator | `parts@repairconnect.local` |
| Shop admin | `admin@repairconnect.local` |

---

## 5. App shell & platform UX

Shared authenticated shell (`AppShell`):

- **Role-scoped sidebar** with Lucide-style icons, active state, collapse, mobile drawer  
- **Shop selector** for multi-shop staff (`GET /api/v1/shops/mine`) — reloads scoped data on switch  
- **Global search** (Ctrl+K / header): repairs, customers, parts, documents (`GET /api/v1/search`)  
- **Notification bell** with unread badge  
- **Language toggle** EN | اردو (RTL when Urdu)  
- **Theme toggle** light / dark / system  
- **Fullscreen** header toggle (Fullscreen API, Escape exit, unsupported graceful message)  
- **Account menu**: Profile, Appearance, Logout  
- **Toasts**, skeletons, modals, data tables, status pills, page headers  
- Responsive layouts for desktop and mobile

---

## 6. Customer portal

| Route | Functionality |
|-------|----------------|
| `/app/customer` | Dashboard: KPIs (active repairs, appointments, pending approvals, completed), analytics charts, pending actions |
| `/app/customer/new` | Submit new repair (device, brand, model, serial, accessories, problem, photos, optional appointment) |
| `/app/customer/repairs` | List own repairs with status filters |
| `/app/customer/appointments` | Book / cancel / reschedule; view slots |
| `/app/customer/shops` | Browse available shops |
| `/app/customer/reports` | Role-gated reports center |
| `/app/repairs/[id]` | Repair detail: status, estimate decision, tracking link/QR, feedback, documents/receipt |
| `/app/notifications` | In-app notifications |
| `/app/profile` | Profile & password |
| `/app/appearance` | Appearance preferences |

### Customer capabilities

- Create repair with idempotency / duplicate guards  
- Approve or reject estimates (with reason)  
- Copy public tracking link / QR  
- Submit 1–5 star feedback after completion  
- Preview / print / download repair receipt (issued invoice snapshot)  
- See customer-visible photos & notes only (internal notes stripped)

---

## 7. Mechanic portal

| Route | Functionality |
|-------|----------------|
| `/app/mechanic` | Dashboard: assigned / in-progress / completed / overdue KPIs, workload charts |
| `/app/mechanic/jobs` | Assigned job list |
| `/app/mechanic/reports` | Mechanic reports |
| `/app/repairs/[id]` | Full mechanic workspace |
| `/app/notifications`, `/app/profile`, `/app/appearance` | Shared |

### Mechanic workspace capabilities

- Add diagnosis (findings, recommended actions, notes)  
- Submit estimate (labor, parts, line items, notes)  
- Request parts for a repair  
- Confirm **parts not required** (explicit readiness gate)  
- Check readiness → **start** work when gates pass  
- Complete work (work performed, final cost)  
- Confirm collection (with other staff roles)  
- Workspace fields: priority, deadline, labor minutes, customer/internal notes  
- Diagnosis & completion checklists (customer vs internal visibility)  
- Photos: device / before / after / other (visibility-aware)  
- Issue allowed document types from completed/active repair UI  

---

## 8. Parts coordinator portal

| Route | Functionality |
|-------|----------------|
| `/app/parts` | Dashboard: available / reserved / low-stock / pending requests, charts |
| `/app/parts/inventory` | Full inventory workspace |
| `/app/parts/requests` | Incoming parts requests → approve / reject / reserve |
| `/app/parts/suppliers` | Supplier CRUD |
| `/app/parts/transfers` | Shop-to-shop stock transfers |
| `/app/parts/reports` | Inventory / operations reports |
| Shared | Notifications, profile, appearance |

### Inventory workspace (`/app/parts/inventory`)

- Overview KPIs: active parts, available, reserved, low stock, out of stock, pending requests  
- Search / filter / sort  
- Create / edit / soft-deactivate parts (`DELETE` → `isActive: false`)  
- **Stock-in**  
- **Adjust** stock with mandatory reason (no negative inventory)  
- View **movements** ledger  
- Pending requests panel  
- Shop-scoped via selected shop  

### Parts request fulfillment

- List incoming requests for shop  
- Approve → atomic reservation (concurrent-safe; `INSUFFICIENT_STOCK` on race)  
- Reject with reason  
- Release reservation  

### Suppliers & restock

- Create / edit suppliers  
- Create restock requests  
- Receive restock → stock-in  

### Transfers

Lifecycle: **requested → approve → dispatch → receive** (aliases `awaiting_transfer` / `in_transit` supported)  
- Cancel / reject  
- Atomic deduct on dispatch / add on receive  
- Movement types `transfer_out` / `transfer_in`  

---

## 9. Shop admin portal

| Route | Functionality |
|-------|----------------|
| `/app/admin` | Premium dashboard: KPIs, trends, sparklines, business overview charts, status donut, top customers, inventory alerts, recent activity, today’s priorities |
| `/app/admin/appointments` | Shop appointments management |
| `/app/admin/repairs` | Shop repair queue; assign mechanics |
| `/app/admin/customers` | Shop customers list |
| `/app/parts/inventory` | Shared inventory workspace |
| `/app/admin/shops` | Shop management (create / edit / activate / archive-check / archive) |
| `/app/admin/reports` | Full reports center + CSV |
| `/app/admin/documents` | Document / receipt shop settings |
| `/app/admin/staff` | List / create staff (mechanic, parts, admin) for member shops |
| `/app/appearance` | Settings / appearance |
| Shared | Notifications; repair detail; document print |

### Shop management

- Create and edit shops (name, address, capacity, hours, cancel policy, etc.)  
- Soft archive with **blocker checks** (active repairs, appointments, reservations, transfers, …)  
- Archive-check endpoint before destructive action  
- Shop summary metrics  

### Staff

- List active memberships for a shop  
- Provision new staff with role + shop membership + audit log  

---

## 10. Repair lifecycle

### Statuses

```
submitted → assigned → diagnosing → estimate_pending
  → estimate_approved | estimate_rejected
  → awaiting_parts | parts_reserved | ready_to_start
  → in_progress → ready_for_collection → completed
(+ cancelled from most non-terminal states)
```

Controlled transitions are enforced in the service layer (`STATUS_TRANSITIONS`).

### Dual gates before start

1. Customer must **approve** estimate.  
2. Parts requirement must be explicit:  
   - `not_required` confirmed by mechanic, **or**  
   - `required` with all parts **reserved**.  
   - `undetermined` blocks start (empty parts list never implies “not required”).

### Work vs collection

- **Work completed** (`ready_for_collection`) — mechanic finished.  
- **Collected / completed** — device handed to customer; job closed.  

### Repair fields

Reference number · device type/brand/model · serial · accessories · problem · photos · priority · deadline · labor minutes · customer/internal notes · checklists · tracking token · warranty months/expiry · feedback · appointment time · final cost · work performed  

### Shared repair detail (`/app/repairs/[id]`)

Role-aware UI for assignment, diagnosis, estimate decision, parts, readiness, start/complete/collect, documents, payments (admin), tracking, feedback, receipt.

---

## 11. Appointments

- Slot discovery based on shop capacity / slot minutes / operating hours  
- Customer book / cancel (respects cancel policy hours) / reschedule  
- Admin view of shop appointments  
- Optional appointment time linked on repair create  

---

## 12. Inventory, suppliers & transfers

| Feature | Detail |
|---------|--------|
| Atomic reservation | Concurrent-safe; fails with insufficient stock |
| Stock-in | Increases available qty + movement record |
| Adjust | Mandatory reason; cannot go negative |
| Soft deactivate | Part remains in history, hidden from active lists |
| Movements | Audit ledger of inventory events |
| Suppliers | Linked to parts / restock |
| Restock | Request → receive → stock-in |
| Transfers | Cross-shop workflow with atomic stock moves |
| Shop scope | All list/mutate paths filtered by membership |

---

## 13. Documents, payments & printing

### Document types

| Type | Purpose |
|------|---------|
| `intake_receipt` | Device intake |
| `job_card` | Shop job card |
| `estimate` | Customer estimate snapshot |
| `invoice` | Itemized invoice |
| `payment_receipt` | Payment confirmation |
| `warranty` | Warranty terms |
| `handover` | Handover / collection |

### Behavior

- Issued with **immutable snapshots** at issue time  
- Sequential document numbers via `DocumentSequence`  
- Shop branding via `ShopSettings` (logo, header/footer, currency, tax, warranty terms, legal name, print defaults)  
- **Payment recording** (cash / card / bank_transfer / other) — no payment gateway  
- Repair marked **PAID** only when recorded payments cover total  
- Financial revenue reporting uses **PaymentRecord** amounts only (not `finalCost`)  

### Print UI (`/app/documents/[id]`)

- Formats: **A4**, **80mm**, **58mm** thermal  
- Browser Print / Save as PDF  
- EN / UR + RTL layout support  

### Admin document settings (`/app/admin/documents`)

- Logo, header/footer, tax label/rate, currency, warranty terms  
- Default print format & language  

---

## 14. Analytics & reports

### Dashboards (Chart.js)

- All four role homes with accessible data tables under charts  
- Date ranges: today / 7d / 30d / 90d / custom  
- Customer: activity & financial summary charts  
- Mechanic: workload / completion charts  
- Parts: stock & request charts  
- Admin: business overview (repairs + recorded revenue), status donut, sparklines, trends  

### Reports center (`/app/*/reports`)

- Backend: `GET /api/v1/reports/center` (+ `.csv`)  
- Categories (role-gated): repairs, financial, inventory, mechanics, customers  
- Operations report + CSV for staff  

### Search

- Scoped global search across repairs / customers / parts / documents  

---

## 15. Notifications

- In-app notification list  
- Mark one / mark all as read  
- Unread badge in shell  
- Per-user notification preference flags (in-app only — no SMS/email delivery claims)  
- Events include estimate decisions, parts status, completion, etc.  

---

## 16. Appearance & preferences

Persisted on `User.preferences` and hydrated on login (cleared on logout):

| Preference | Options |
|------------|---------|
| Theme | light / dark / system |
| Accent | indigo / blue / teal / violet / emerald |
| Density | comfortable / compact |
| Font scale | standard / large |
| Reduced motion | on / off |
| High contrast | on / off |
| Chart style | bar / line / donut |
| Sidebar collapsed | boolean |

UI: `/app/appearance` + CSS hooks for accent, density, large text, reduced motion, high contrast.

---

## 17. Internationalization & accessibility

- Dictionaries: English (`en`) and Urdu (`ur`)  
- Full **RTL** layout when Urdu is selected  
- Status labels localized  
- Marketing accessibility page + portal a11y practices  
- Keyboard-friendly shell (search, sidebar, fullscreen)  
- Charts paired with accessible data tables  
- `prefers-reduced-motion` / user reduced-motion preference respected  
- Playwright a11y coverage on portals; NVDA checklist documented for manual pass  

---

## 18. Security & multi-tenant isolation

| Control | Implementation |
|---------|----------------|
| Auth cookies | HttpOnly JWT; Secure in production / cross-site |
| CSRF | Double-submit cookie + header |
| Password hashing | bcrypt (cost 12) |
| Input validation | Zod schemas on all mutating routes |
| RBAC | `authenticate` + `requireRoles` |
| Shop isolation | Membership + `assertShopAccess` / `shopQuery` |
| Repair isolation | `assertCanViewRepair` / `assertCanMutateRepair` |
| Customer payload hygiene | Strip `internalNotes` / internal checklist & photos |
| Audit log | Staff create and other sensitive actions |
| Production guards | Forbid memory DB, empty URI, demo login, weak JWT |
| Swagger | Documented at `/api/docs` |
| Isolation tests | Customer A↛B, Mechanic A↛B, Parts A↛B, Admin A↛B, public track PII-free |

---

## 19. API map

Base: `/api/v1` · Docs: `/api/docs`

### Auth — `/api/v1/auth`

| Method | Path | Notes |
|--------|------|-------|
| POST | `/register` | Customer |
| POST | `/login` | |
| POST | `/logout` | |
| POST | `/refresh` | |
| POST | `/forgot-password` | Non-enumerating |
| GET | `/csrf` | |
| GET | `/me` | |
| PATCH | `/me/profile` | |
| POST | `/me/password` | |
| PATCH | `/me/preferences` | Appearance |
| PATCH | `/me/notifications` | |
| PATCH | `/me/language` | |
| GET | `/staff` | Admin |
| POST | `/staff` | Admin create |

### Repairs — `/api/v1/repairs`

| Method | Path | Roles |
|--------|------|-------|
| GET | `/` | Scoped list |
| GET | `/stats/summary` | Scoped |
| GET | `/:id` | View if allowed |
| POST | `/` | Customer create |
| POST | `/:id/assign` | Admin |
| POST | `/:id/diagnosis` | Mechanic/Admin |
| POST | `/:id/estimates` | Mechanic/Admin |
| POST | `/estimates/:estimateId/decision` | Customer |
| POST | `/:id/parts-requests` | Mechanic/Admin |
| POST | `/:id/parts-not-required` | Mechanic/Admin |
| GET | `/:id/readiness` | |
| POST | `/:id/start` | Mechanic/Admin |
| POST | `/:id/complete` | Mechanic/Admin |
| POST | `/:id/collect` | Staff |
| PATCH | `/:id/workspace` | Mechanic/Admin |
| POST | `/:id/feedback` | Customer |
| GET | `/:id/receipt` | Customer/Admin/Mechanic |

### Parts — `/api/v1/parts`

List/create/update/deactivate · stock-in · adjust · incoming requests · approve/reject · release reservation · movements  

### Transfers — `/api/v1/transfers`

List · create · approve · reject · cancel · dispatch · receive  

### Suppliers — `/api/v1/suppliers`

CRUD · restock-requests create/list/receive  

### Shops — `/api/v1/shops`

Public/list · mine · get · summary · archive-check · create · patch · archive  

### Appointments — `/api/v1/appointments`

Slots · list · book · cancel · reschedule  

### Documents — `/api/v1/documents`

Settings get/patch · list · get · issue · payments  

### Analytics — `/api/v1/analytics`

`/me` · `/customer` · `/mechanic` · `/parts` · `/admin`  

### Reports — `/api/v1/reports`

`/center` · `/center.csv` · `/operations` · `/operations.csv`  

### Other

| Path | Purpose |
|------|---------|
| `GET /api/v1/search` | Global scoped search |
| `GET /api/v1/notifications` | List |
| `POST /api/v1/notifications/:id/read` | Mark read |
| `POST /api/v1/notifications/read-all` | Mark all |
| `GET /api/v1/public/track/:token` | Public status |

---

## 20. Data models

| Model | Purpose |
|-------|---------|
| `User` | Accounts, role, preferences, notification prefs, language |
| `ShopMembership` | User ↔ shop ↔ role |
| `RepairShop` | Shop profile, capacity, hours, cancel policy, archive |
| `RepairRequest` | Core job + device + workflow + feedback + warranty |
| `RepairAssignment` | Mechanic assignment |
| `Diagnosis` | Findings |
| `RepairEstimate` | Cost estimate versions |
| `EstimateDecision` | Approve/reject |
| `RepairStatusHistory` | Status audit trail |
| `PartsRequest` | Part demand for a repair |
| `PartsReservation` | Reserved stock link |
| `Part` | SKU / qty / thresholds / supplier |
| `InventoryMovement` | Stock ledger |
| `Supplier` | Vendor records |
| `RestockRequest` | Purchase/restock pipeline |
| `StockTransfer` | Cross-shop transfer |
| `Appointment` | Booked slots |
| `Notification` | In-app alerts |
| `AuditLog` | Sensitive action log |
| `PasswordReset` | Reset tokens |
| `ShopSettings` | Document branding / tax / print defaults |
| `DocumentSequence` | Numbering |
| `FinancialDocument` | Issued snapshots |
| `PaymentRecord` | Recorded payments |

---

## 21. Route map (UI)

### Public

`/` · `/login` · `/register` · `/forgot-password` · `/privacy` · `/terms` · `/accessibility` · `/track/[token]`

### Shared app

`/app/notifications` · `/app/profile` · `/app/appearance` · `/app/repairs/[id]` · `/app/documents/[id]`

### Customer

`/app/customer` · `/new` · `/repairs` · `/appointments` · `/shops` · `/reports`

### Mechanic

`/app/mechanic` · `/jobs` · `/reports`

### Parts

`/app/parts` · `/inventory` · `/requests` · `/suppliers` · `/transfers` · `/reports`

### Admin

`/app/admin` · `/appointments` · `/repairs` · `/customers` · `/shops` · `/reports` · `/documents` · `/staff`

---

## 22. Out of scope / known limitations

| Item | Status |
|------|--------|
| Payment gateway (Stripe, etc.) | Out of scope — record-only payments |
| Server-side PDF binary (pdfkit) | Not required — browser print/PDF |
| SMS / email notification delivery | Prefs exist; no delivery claims |
| Platform / org-level super-admin | Not implemented — shop_admin is top authority |
| Widget drag-and-drop dashboard rearrange | Not implemented |
| Dedicated `RepairWorkLog` / `DeviceIntake` collections | Deferred; fields live on repair |
| Public production deploy | Requires explicit authorization |
| Full NVDA screen-reader pass | Manual checklist pending |
| Estimate revision full re-approval entity | Partial |

---

## How to run

```bash
cp .env.example .env
npm install
npm run dev
```

| Service | URL |
|---------|-----|
| App | http://localhost:5173 |
| API | http://localhost:5000 |
| Swagger | http://localhost:5000/api/docs |

```bash
npm run test -w server          # Vitest API
npm run test:e2e -w client      # Playwright UI/a11y
npm run verify:atlas -w server  # Atlas persistence + reservation
```

---

*Generated from the RepairConnect monorepo feature surface (marketing, portals, repair workflow, inventory, documents, analytics, security). For implementation history see `IMPLEMENTATION_REPORT.md`, `ADVANCED_SAAS_IMPLEMENTATION_REPORT.md`, and `PREMIUM_SAAS_IMPLEMENTATION_REPORT.md`.*
