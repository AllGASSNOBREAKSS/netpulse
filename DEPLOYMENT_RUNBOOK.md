# Secure deployment and rollback runbook

## Pre-deployment gates

- Review the complete diff and dependency/lockfile changes.
- Run secret scan, `npm audit --omit=dev`, `npm run check`, security tests, and manual browser checks.
- Confirm no `.env`, local Vercel metadata, coverage/build output, database dump, or sensitive log is tracked.
- For schema changes, attach verified backup/restore and staging-migration evidence from [DATABASE_RUNBOOK.md](DATABASE_RUNBOOK.md).
- Confirm Turnstile exact hostname/action validation, Cloudflare/API rate controls, least-privilege database credentials, privacy notice, and rollback owner.
- Require passing checks and a protected production-environment approval. Do not deploy around failed gates.

## Staging

Deploy an immutable commit to a separate environment with separate secrets and test data. Verify static navigation, speed test, diagnostics, local history, Area Pulse unavailable/fail-closed behavior, then configured Area Pulse context/report/delete/rate-limit/duplicate/Turnstile/official-ingestion/retention flows. Check response headers, CORS denial, logs, mobile/desktop, keyboard access, and light/dark themes.

Use Cloudflare's documented testing keys only in non-production. Production keys must not accept dummy tokens.

## Production

Promote the validated commit; do not rebuild from an unreviewed worktree. Verify deployment logs, homepage and API status, CSP/security headers, measurement flow, history/navigation/footer, Area Pulse privacy copy and report deletion, Turnstile validation, rate controls, and absence of raw IP/location in application responses/log fields.

## Rollback

Prefer redeploying the last known-good immutable commit. Disable only the affected API mutation at the edge if static measurement remains safe. Database rollback must follow the prepared migration plan; do not restore over production until evidence is preserved and the restore is verified. Rotate credentials when compromise is suspected even if code is rolled back.

Record deployed and rollback commit IDs, Vercel deployment IDs, migration versions, backup ID, approver, UTC time, verification results, and remaining risks. Never place secrets in deployment notes.
