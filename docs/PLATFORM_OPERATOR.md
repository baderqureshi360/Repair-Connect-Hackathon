# Platform shop application operators

Platform operators review and approve shop-owner registrations. This authority is **separate** from the four operational roles (`customer`, `mechanic`, `parts_coordinator`, `shop_admin`). Ordinary shop admins never receive these privileges.

## What operators can do

- Sign in at `/login?portal=shop` with a `platform_operator` account.
- Open **Shop applications** at `/app/platform/shop-applications`.
- Filter **Pending / Approved / Rejected / All**.
- Inspect application details.
- **Approve** — runs the verified provisioning service (one shop + one `shop_admin` membership; owner password preserved; reviewer + audit recorded).
- **Reject** — requires a reason (min 5 characters).

Applicants cannot approve their own applications. Duplicate approvals are blocked.

## Secure bootstrap (no default account)

RepairConnect **does not** seed or hardcode a platform administrator. Create the first operator only when you intentionally hold the provisioning secret:

1. Set a long random `PROVISIONING_API_KEY` (≥ 16 chars) in the monorepo root `.env`.
2. Run:

```bash
npm run platform:create-operator -w server -- \
  --email ops@yourdomain.com \
  --name "Platform Ops" \
  --password 'YourStrongPass1' \
  --confirm-key "<same value as PROVISIONING_API_KEY>"
```

Password via stdin:

```bash
echo 'YourStrongPass1' | npm run platform:create-operator -w server -- \
  --email ops@yourdomain.com \
  --name "Platform Ops" \
  --password-stdin \
  --confirm-key "<PROVISIONING_API_KEY>"
```

The command refuses to run without a matching `--confirm-key`, refuses weak passwords, and never overwrites an existing user.

## Automation (optional)

CLI / HTTP provisioning with `X-Provisioning-Key` remains available for ops automation — see `docs/SHOP_OWNER_PROVISIONING.md`. Prefer the platform UI for human review so reviewer identity is recorded on the application and audit log.

## Security notes

- Public registration and shop staff APIs cannot create `platform_operator` users.
- Platform APIs require cookie (or test Bearer) auth with role `platform_operator` only.
- Customers and shop staff receive `403` on `/api/v1/platform/shop-applications*`.
- Do not create operators against production Atlas without explicit authorization.
