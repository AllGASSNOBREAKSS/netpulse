# Incident response runbook

This runbook is operational guidance. It should be exercised at least twice per year and after major infrastructure changes.

## Severity

- **SEV-1:** confirmed credential/database compromise, material personal-data exposure, malicious production deployment, active destructive abuse, or sustained service-wide outage.
- **SEV-2:** exploitable vulnerability without confirmed compromise, false official provider notices, significant API/bandwidth abuse, or partial regional outage.
- **SEV-3:** suspicious activity, limited failed abuse, low-impact defect, or policy violation.

## Detect and triage

1. Open an incident record with UTC times and an incident lead.
2. Record the alert source, affected environment/routes, first known activity, scope, data classes, and current evidence. Do not copy raw secrets or full sensitive payloads into tickets/chat.
3. Preserve relevant Vercel, Cloudflare, GitHub, database, and provider audit logs with access controls and hashes where feasible.
4. Distinguish confirmed facts from hypotheses. Escalate legal/privacy/user-notification decisions to qualified counsel and appropriate leadership.

## Contain

Use the least destructive effective option:

- Disable Area Pulse reporting by removing/rotating its server secret or blocking the mutation route while retaining read-only diagnostics.
- Revoke compromised GitHub/Vercel/Cloudflare/database credentials and sessions; rotate related secrets because reuse and lateral exposure may be unknown.
- Block abusive signatures/rates at the edge without broadly excluding accessibility tools, shared networks, VPNs, or regions unless justified.
- Suspend provider-message ingestion if official-status integrity is uncertain.
- Preserve database evidence before deletion or migration. Do not destroy production data without the required approval.

## Eradicate and recover

1. Patch the root cause with peer review and passing security/functional checks.
2. Restore from a verified clean backup only when integrity requires it; test the restore in isolation first.
3. Deploy to staging, verify indicators of compromise are absent, then use a protected production approval.
4. Monitor error, WAF, Turnstile rejection, rate-limit, database, and deployment signals closely after recovery.
5. Notify affected users/regulators only through the counsel-led decision process applicable to the incident and jurisdiction. Do not promise a universal notification threshold in this engineering document.

## Post-incident

Within five business days where practical, document timeline, impact, root causes, controls that worked/failed, detection gap, corrective owners/dates, credential rotations, and disclosure decisions. Update tests, runbooks, threat model, and retention controls. Keep a blameless technical focus while preserving accountability for privileged actions.

## Evidence and privacy

Restrict evidence to the incident team; store it separately from normal app data; avoid raw IPs/payloads unless necessary and authorized; record access; define a deletion date; and consult counsel before cross-border transfers or disclosure.
