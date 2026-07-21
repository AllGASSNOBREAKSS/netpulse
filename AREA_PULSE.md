# Area Pulse and ISP Plan Reality Check

## Status

The codebase contains a fail-closed Area Pulse implementation and local Plan Reality analysis. Area Pulse is not operational merely because the UI and API routes exist: PostgreSQL, a privacy HMAC secret, Turnstile keys, an exact hostname, migration/role application, backup/restore evidence, and edge controls are release requirements.

## Backend architecture

1. `GET /api/area-pulse/context` reads Vercel's coarse country/subdivision/city headers and reports whether the complete stack is available.
2. `POST /api/area-pulse/report` accepts strict JSON, validates Turnstile server-side, derives purpose-separated HMAC keys from the transient platform address, applies transactional reporter/duplicate limits, and stores a short-lived report.
3. `GET /api/area-pulse/incidents` loads only the caller's coarse region and returns privacy-thresholded aggregates plus signed official notices.
4. `DELETE /api/area-pulse/report` requires the high-entropy deletion token returned at creation. Only its hash is stored.
5. `POST /api/area-pulse/abuse` accepts a private, rate-limited, Turnstile-protected aggregate flag; flags are never public.
6. `POST /api/area-pulse/provider-status` requires an HMAC signature over timestamp, nonce, and exact body. Used nonces are stored to prevent replay.
7. `GET /api/area-pulse/maintenance` requires the cron/maintenance bearer and deletes only expired records.

All SQL values use postgres.js tagged templates. The base migration revokes `PUBLIC`; the separately reviewed privileged script creates a no-login application group role and RLS policies. Database ownership, backups, provider logs, and role membership remain operator responsibilities.

## Data sources

- Explicit anonymous reports: user-selected pattern and user-confirmed ISP/ASN.
- Optional limited latest NetPulse summary: confidence, throughput, idle latency, and only directly available diagnostic booleans.
- Approximate region: Vercel request geolocation headers; never exact coordinates.
- Historical regional report counts: older Area Pulse rows grouped by provider/pattern/service.
- Browser checks: NetPulse API, Cloudflare zero-byte HTTPS, and Cloudflare DNS-over-HTTPS. These are real transactions but are **not** treated as independently operated corroboration.
- Official notices: only records accepted through the signed provider-ingestion endpoint with a public HTTPS source and timestamp.

There is no proprietary outage feed, prohibited scraping, social-media rumor ingestion, or fabricated report source.

## Aggregation and confidence

- Crowd window: 30 minutes.
- Cluster key: provider/ASN, coarse region, failure pattern, and named service where applicable.
- Publication minimum: 3 distinct HMAC reporter keys. One report never becomes a public incident.
- `possible`: at least 3 distinct reporters.
- `likely`: at least 5 distinct reporters **and** either a mature historical deviation (at least 8 baseline windows; current distinct reporters at least mean + max(2, 2× standard deviation)) or genuinely independently operated destination corroboration. Current browser checks do not satisfy the latter.
- `official`: an active signed notice from a configured official provider source matches provider and region.
- Base score: 45 + up to 20 for additional reporters; +10 when at least 75% of same-provider window reports match the pattern; +15 for independently operated corroboration; +15 for mature historical deviation. `possible` caps at 74, `likely` at 94, and `official` is 100.

The score is evidence transparency, not a probability. Clusters expire no later than one hour after their last observation and never beyond their underlying report expiry.

## Privacy and abuse controls

- No raw address or exact coordinate columns.
- Purpose-separated HMAC reporter, duplicate, audit, and abuse keys.
- 5 reports/hour and 20/day per reporter key; matching duplicate rejected for 30 minutes.
- 3 private aggregate flags/day; matching duplicate rejected for 24 hours.
- Notes reject markup, URLs, contact details, control characters, and repeated-character spam; notes are not public.
- Report deletion token stays in the visitor's browser; only its SHA-256 domain-separated hash is stored.
- Maximum report/audit/abuse-row retention: 30 days. Provider notices are removed seven days after expiry; nonces after ten minutes.
- Public responses contain no reporter key, note, deletion hash/token, raw address, or coordinate.

See [PRIVACY.md](PRIVACY.md), [SECURITY_AUDIT.md](SECURITY_AUDIT.md), [DATABASE_RUNBOOK.md](DATABASE_RUNBOOK.md), and [CLOUDFLARE.md](CLOUDFLARE.md).

## Browser and data limitations

IP-based city/subdivision/country can be wrong for VPNs, mobile carriers, enterprise gateways, satellite systems, and privacy relays. Sparse regions plus ISP identity may still permit inference. A report cannot prove whether the fault is in a device, Wi-Fi/router, ISP access network, route, destination, or broader internet. The UI therefore provides an accessible list and honest empty states rather than a synthetic heatmap.

## Plan Reality formulas

Plan Reality operates only on local History entries with confidence at least 65 and positive download, upload, and idle latency.

- Download/upload: medians of eligible tests.
- Delivered percentage: median measured rate ÷ user-entered listed rate × 100.
- Peak: median download from at least two tests recorded 18:00–22:59 in each test's saved timezone.
- Off-peak: median of at least two other tests.
- Wi-Fi/Ethernet: separate medians requiring at least two user-labeled tests per group. Browsers do not supply a reliable medium label.
- Loaded rise: median of max(0, loaded latency − idle latency), separately for download and upload.
- Reliability indicator: 50% download consistency using `1 − median absolute deviation / median`, 25% median per-run stability, and 25% median worst loaded-latency quality (100 at ≤20 ms rise, linear to 0 at ≥300 ms). Missing stability/loaded data contributes a neutral 50, disclosed by the formula.

The support report includes plan inputs, dates, user labels, peak/off-peak and wired/Wi-Fi medians, confidence exclusions, methodology, and limitations. It does not claim breach, fraud, compensation, uptime, or outage duration.

## Required environment values

Use `.env.example` as names-only guidance. `DATABASE_URL`, `AREA_PULSE_HASH_SECRET`, `TURNSTILE_SECRET_KEY`, `AREA_PULSE_EXPECTED_HOSTNAME`, provider-ingestion, and maintenance secrets are server-only. `VITE_TURNSTILE_SITE_KEY` is intentionally public. Do not commit values or copy server secrets into `VITE_*` variables.
