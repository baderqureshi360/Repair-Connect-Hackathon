# Shop owner registration & provisioning

## Owner journey

1. Visit `/shop-registration` and submit owner + shop details with a password.
2. System creates a `User` (`role: shop_admin`, `accountStatus: pending_shop_owner`) and a `ShopApplication` (`status: pending_review`) in one transaction. **No** `ShopMembership` yet.
3. Owner signs in at `/login?portal=shop` with the same credentials.
4. Server redirects to `/app/shop-application/status` (operational shop/customer APIs return `403 ONBOARDING_PENDING`).
5. An authorized operator approves the application (CLI or provisioning API).
6. Approval creates the `RepairShop`, activates `ShopMembership` (`shop_admin`), sets `accountStatus: active`, and audits the action.
7. Next login opens `/app/admin` with access limited to that shop.

## Platform operator UI (recommended)

Authorized `platform_operator` accounts review applications in the product UI:

- Setup: see [`PLATFORM_OPERATOR.md`](./PLATFORM_OPERATOR.md)
- Page: `/app/platform/shop-applications`
- APIs: `/api/v1/platform/shop-applications` (cookie auth, role-gated)

## Automation provisioning (API key)

Approval can also use a shared secret for CLI / automation:

```bash
# monorepo root .env
PROVISIONING_API_KEY=<long-random-secret-min-16-chars>
```

### CLI

```bash
npm run provision:shop-application -w server -- approve --id SA-xxxxxxxxxxxx
npm run provision:shop-application -w server -- reject --id SA-xxxxxxxxxxxx --reason "Incomplete documentation"
npm run provision:shop-application -w server -- claim --id SA-xxxxxxxxxxxx --email owner@example.com
```

`claim` is only for **historical** applications that have no `owner` yet. It requires the pending owner account email to **exactly** match the application business email after manual verification. It never auto-links from an unverified public form.

### HTTP API

Send header `X-Provisioning-Key: <PROVISIONING_API_KEY>`:

- `POST /api/v1/shop-applications/provision/approve` `{ "publicId": "SA-...", "remarks": "..." }`
- `POST /api/v1/shop-applications/provision/reject` `{ "publicId": "SA-...", "reason": "..." }`
- `POST /api/v1/shop-applications/provision/claim` `{ "publicId": "SA-...", "ownerEmail": "..." }`

If `PROVISIONING_API_KEY` is missing or shorter than 16 characters, these endpoints return `503 PROVISIONING_DISABLED`.

## Security notes

- Public registration never trusts client-supplied `role` or `shopId`.
- Passwords are bcrypt-hashed (cost 12); plaintext is never stored.
- Pending owners cannot call shop-management APIs even with a valid session cookie.
- Duplicate email and duplicate pending applications are rejected (`409`).
- Duplicate approval / duplicate shop creation is blocked.
- Applicants cannot approve their own applications (no membership + provisioning key required).
- Email delivery is **not** claimed; invitations can be added later only when a mail provider is configured.
