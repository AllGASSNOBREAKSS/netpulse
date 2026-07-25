# Privacy notice draft

> **Draft for qualified legal review.** This document describes the current
> implementation and proposed regional-node design as of 2026-07-25. Hosting,
> measurement, identity, DNS, database, and security providers may process
> additional request metadata under their own settings and terms. Do not
> publish this as final legal advice without review.

## Local-first data

Speed-test history, ISP plan profiles, Fix My Internet sessions, and Connection Black Box sessions are stored in the visitor's browser. NetPulse does not upload those local records merely because a test runs. Clearing browser storage removes them from that browser. Exported files or copied share payloads are controlled by the recipient after export.

## Network measurements and third parties

The browser contacts the selected measurement, DNS, connectivity, and public-network identity endpoints described in the in-app methodology. Those providers receive ordinary request metadata, including the public address used to reach them. NetPulse should not claim those providers collect nothing. Current source does not add advertising analytics or cross-site tracking cookies.

The current active speed-test fallback is Cloudflare anycast. NetPulse does not
operate that service or control its independent data practices. ISP/ASN and
approximate-location lookup is user initiated and uses the named third-party
provider. Location may be wrong for VPN, relay, enterprise, mobile, satellite,
or carrier-grade NAT users.

## Proposed regional test nodes

No NetPulse regional test node is currently deployed. Before a pilot, the
reviewed protocol requires:

- payload bodies generated only for measurement and never stored;
- raw public addresses used transiently for routing and abuse control, not
  application analytics;
- rotating, purpose-separated pseudonymous abuse keys;
- coarse regional operational aggregation;
- short documented raw-log and security-event retention;
- separate anonymous operational data and any future account data;
- opt-in before retaining a user's result beyond what is necessary to execute
  the requested test;
- privacy-safe export/deletion and regional legal review.

The proposed default targets are 24-72 hours for raw operational request logs
when necessary and 30 days for coarse aggregates. Those are architecture
targets, not a final promise. Actual periods, subprocessors, residency,
cross-border transfers, consent, child protection, and legal bases require
qualified review before each region launches.

## Area Pulse

Area Pulse is disabled unless its server infrastructure is fully configured. When a visitor explicitly submits a report:

- The hosting platform derives an approximate city, subdivision, or country from the request address.
- The full request address is used transiently to create purpose-separated HMAC reporter, duplicate, and audit keys and to validate abuse controls. NetPulse does not intentionally store the raw address or exact coordinates in the Area Pulse tables.
- The submitted incident type, user-confirmed ISP/ASN, optional service/note, coarse region, and limited measurement summary may be stored.
- Report rows are retained for no more than 30 days; incident visibility expires sooner. Audit keys and events expire after 30 days. Expired provider messages are removed after seven additional days.
- Notes, reporter keys, deletion-token hashes, and individual report records are not included in public aggregates. At least three distinct reporter keys are required before a crowd cluster is public.
- A deletion token is returned to the browser and stored locally. Anyone with that token can delete that report; NetPulse cannot recover a lost token.
- A visitor may privately flag an aggregate for abuse. The reason, optional details, pseudonymous rate-limit and duplicate keys, and incident identifier are retained for no more than 30 days and are never published in the aggregate.

Turnstile processes challenge data under Cloudflare's terms. Vercel and the selected PostgreSQL provider may retain security or access logs outside the application tables. Operators must configure and disclose those retention periods before launch.

## Sharing, access, and deletion

Black Box share payloads are generated locally, exclude the public IP, and expire during import after seven days. They are not an access-control mechanism: anyone who receives an unexpired payload can read it. Area Pulse reports can be deleted with their local deletion receipt. Operational log access should be limited to authorized maintainers and used for security, reliability, and abuse response.

## Location and sensitive inference

IP-based location is approximate and may be wrong for VPN, mobile, satellite, enterprise, or privacy-relay users. Coarse region plus ISP/ASN can still enable inference in sparsely populated areas. Do not submit Area Pulse reports if that risk is unacceptable.

## Cookies and analytics

The current application does not implement account cookies or advertising analytics. Browser local storage preserves theme, navigation, measurements, diagnostics, and optional report deletion receipts. If analytics, cookies, or accounts are introduced, this notice and consent behavior must be updated before release.

## Contact and changes

Privacy questions should use the project contact route published in the application/repository. Material collection or retention changes require an updated notice and release review.
