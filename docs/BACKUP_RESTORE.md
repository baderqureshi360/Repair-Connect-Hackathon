# RepairConnect — Database Backup & Restore

Database: MongoDB Atlas cluster, logical database name `repairconnect`.

## Recovery objectives (targets)

| Metric | Target | Notes |
|--------|--------|-------|
| **RPO** (max data loss) | ≤ 1 hour (Continuous/PITR) or ≤ 24h (daily snapshots) | Set by Atlas tier + schedule |
| **RTO** (time to serve again) | ≤ 4 hours | Restore to new cluster + DNS/env cutover |
| Probe DB | `repairconnect_p6_backup_probe` | App-level restore mechanics only — not a substitute for Atlas backups |

## Continuous Backup / PITR availability

| Capability | Where to check | Phase 6.2 status |
|------------|----------------|------------------|
| Cloud Backup enabled | Atlas → Cluster → **Backup** | **Unverified on live org** — ops must confirm in UI |
| Continuous Backup / PITR | Same page; tier-dependent (often M10+) | Document whether PITR window is 24h / 48h / custom |
| Snapshot schedule | Backup policy | Prefer daily + weekly retention ≥ 7 / 30 days |
| Latest successful backup | Backup → Snapshots / Activity | Record timestamp in go-live ticket |

**Do not claim Continuous Backup is on until Atlas UI shows an active policy and a recent successful snapshot.**

## Recommended production backups (Atlas)

1. Atlas UI → your cluster → **Backup**.
2. Enable **Cloud Backup** (continuous or snapshot schedule).
3. Retention: at least daily snapshots + point-in-time restore if Continuous Backup is available on the tier.
4. Test restore quarterly into a **non-production** project/cluster.

### Verify latest backup (ops)

1. Open Atlas → Backup.
2. Confirm newest snapshot **Succeeded** (not failed/queued).
3. Note `snapshotId`, time (UTC), and size in the release checklist.
4. Optional: Atlas CLI `atlas backups snapshots list --clusterName <name>`.

### Restore from Atlas snapshot

1. Atlas → Backup → select snapshot → **Restore**.
2. Restore into a **new** cluster or temporary database (never overwrite production without a maintenance window).
3. Update a staging API `MONGODB_URI` to the restored cluster.
4. Run smoke: `GET /health` and `GET /ready` expect `dbMode: "atlas"`, then login + open one repair.

## Logical dump (ops laptop / bastion)

Requires MongoDB Database Tools (`mongodump` / `mongorestore`).

```bash
# Dump (read-only credentials preferred)
mongodump --uri="$MONGODB_URI" --db=repairconnect --out=./backups/repairconnect-$(date +%Y%m%d)

# Restore into an isolated database name (never silently overwrite prod)
mongorestore --uri="$MONGODB_URI_STAGING" --nsFrom="repairconnect.*" --nsTo="repairconnect_restore_test.*" ./backups/repairconnect-YYYYMMDD/repairconnect
```

## Application verification helpers (non-destructive)

```bash
# Isolated DB probe (Phase 6) — never targets production logical DB name
npm run probe:backup-restore -w server

# Optional tagged smoke (refuses destructive clears in production):
npx tsx server/src/scripts/verifyBackupRestoreSmoke.ts
```

## What must never be restored into production blindly

- Demo `@repairconnect.local` users from a seed dump
- Old JWT secrets embedded in notes/logs
- Staging `OutboxEvent` / test payment ledgers mixed into live shops
