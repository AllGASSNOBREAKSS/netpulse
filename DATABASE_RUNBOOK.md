# Area Pulse database runbook

Area Pulse uses PostgreSQL through a provider-neutral connection string. The application must fail closed when the database or secrets are absent.

## Environments and roles

- Use separate development, staging, and production databases and credentials.
- Create a provider-managed login with a strong rotated credential, then grant it the inheriting, non-login `netpulse_area_app` role defined in `migrations/privileged/area_pulse_roles.sql`. Verify the login receives only the grants listed in that script.
- The privileged role script requires owner-level capabilities and may be unsupported on some managed plans. Review it with the database operator; do not run it from the application.
- Never expose the connection string or owner/service-role credentials to `VITE_*` variables or the browser.
- Require TLS and restrict network access where the provider supports it.

## Safe migration procedure

1. Review SQL, query plans, locks, and rollback. Confirm no statement destroys production data.
2. Create a provider backup/snapshot and record its identifier, UTC time, retention, and encryption status.
3. Restore that backup into an isolated database and verify table counts and representative rows without copying sensitive values into logs.
4. Apply the migration and privileged-role script to staging. Run policy, API, rate-limit, duplicate, deletion, and retention tests using non-production data.
5. Prepare rollback SQL or a restore decision, maintenance window, responsible operator, and abort thresholds.
6. Obtain explicit confirmation before any permanent production-data deletion.
7. Apply through an audited production identity, verify schema/privileges/RLS, and monitor errors/latency.

`001_area_pulse.sql` only creates tables/indexes and revokes `PUBLIC`; it is intended to be additive. That does not remove the backup/staging requirement.

## Backup and restore evidence

At least quarterly, restore the latest encrypted production backup to an isolated environment, verify schema, row counts, report deletion behavior, and application read/write with a staging credential, then destroy the restore under the provider's secure process. Record the test without storing report notes or pseudonymous keys in the runbook.

## Retention and deletion

- Reports: maximum 30 days; public incident expiry is shorter.
- Audit events: 30 days.
- Admin nonces: 10 minutes.
- Private aggregate-abuse reports: 30 days.
- Expired provider messages: removed seven days after expiry.
- The authenticated cron/maintenance route removes only expired application rows.

Review provider backups and database/access logs separately because application deletion may not immediately remove backup copies. Document their real retention before launch.

## Monitoring

Alert on connection/authentication failures, abnormal query time, storage growth, migration events, privilege/role changes, repeated nonce conflicts, rate-limit spikes, and unusual administrative writes. Redact connection strings, SQL parameters, notes, deletion tokens, reporter keys, and raw request addresses.
