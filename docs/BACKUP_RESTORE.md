# RepairConnect — Database Backup & Restore

Database: MongoDB Atlas cluster, logical database name `repairconnect`.

## Recommended production backups (Atlas)

1. Atlas UI → your cluster → **Backup**.
2. Enable **Cloud Backup** (continuous or snapshot schedule).
3. Retention: at least daily snapshots + point-in-time restore if Continuous Backup is available on the tier.
4. Test restore quarterly into a **non-production** project/cluster.

### Restore from Atlas snapshot

1. Atlas → Backup → select snapshot → **Restore**.
2. Restore into a new cluster or temporary database (never overwrite production without a maintenance window).
3. Update a staging API `MONGODB_URI` to the restored cluster.
4. Run smoke: `GET /health` expects `dbMode: "atlas"`, then login + open one repair.

## Logical dump (ops laptop / bastion)

Requires MongoDB Database Tools (`mongodump` / `mongorestore`).

```bash
# Dump (read-only credentials preferred)
mongodump --uri="$MONGODB_URI" --db=repairconnect --out=./backups/repairconnect-$(date +%Y%m%d)

# Restore into an isolated database name (never silently overwrite prod)
mongorestore --uri="$MONGODB_URI_STAGING" --nsFrom="repairconnect.*" --nsTo="repairconnect_restore_test.*" ./backups/repairconnect-YYYYMMDD/repairconnect
```

## Application verification helper

```bash
# Atlas-connected machine with tools installed:
npx tsx server/src/scripts/verifyBackupRestoreSmoke.ts
```

This script performs a **non-destructive** round-trip of a single isolated collection document tagged `@repairconnect.verify` and deletes it afterward. It refuses `NODE_ENV=production` destructive clears.

## What must never be restored into production blindly

- Demo `@repairconnect.local` users from a seed dump
- Old JWT secrets embedded in notes/logs
- Staging `OutboxEvent` / test payment ledgers mixed into live shops
