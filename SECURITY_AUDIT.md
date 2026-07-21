# NetPulse security and privacy audit

**Audit date:** 2026-07-19
**Scope:** repository source, browser measurement engine, local history, Area Pulse API design, PostgreSQL migration, Vercel configuration, and proposed operating controls.
**Status:** engineering assessment, not a certification or guarantee. No system is unhackable. Reassess after material architecture changes and before enabling Area Pulse in production.

## Architecture and trust boundaries

NetPulse is a Vite/React browser application hosted on Vercel. Normal speed tests call configured public HTTPS measurement endpoints directly from the browser. Test history, diagnostic sessions, plan profiles, and Black Box sessions are local-first browser storage. Area Pulse adds same-origin Vercel Functions and a provider-neutral PostgreSQL database. Cloudflare Turnstile is required only for anonymous Area Pulse submission.

Assets include deployment and GitHub credentials, server-only database and HMAC secrets, provider-ingestion signing keys, anonymous deletion tokens, pseudonymous reporter keys, coarse region and ISP/ASN labels, local test history, measurement endpoint capacity, project name/logo, and source/license notices.

Entry points include the static application, external measurement endpoints, `/api/area-pulse/*`, local/shared Black Box payloads, browser storage, dependency and CI workflows, Vercel environment configuration, PostgreSQL, GitHub, and future Cloudflare controls.

Trust boundaries:

1. Untrusted browser input to the React UI and public APIs.
2. Browser-to-third-party measurement, DNS, identity, and Turnstile services.
3. Vercel edge/function headers to server code. Security rate keys rely only on `x-vercel-forwarded-for`.
4. Server functions to PostgreSQL and Cloudflare Siteverify.
5. Signed operator/provider ingestion to the administrative API.
6. Repository/CI to Vercel deployment and production secrets.

## Threat and control register

| Threat | Risk | Existing or implemented controls | Residual risk / required operation |
|---|---:|---|---|
| Anonymous bots and fake outage reports | High | Turnstile server validation; exact action/hostname; HMAC reporter keys; 5/hour and 20/day database-enforced limits; 30-minute duplicate rejection; 3-report publication floor; baseline/official evidence gates | Distributed solvers and residential proxies can still submit. Add Cloudflare endpoint rate rules and monitor rejection ratios before launch. |
| Bandwidth abuse and test endpoint exhaustion | High | Fixed client durations, concurrency and transfer caps; low-data mode; no anonymous Area Pulse action starts a speed test | Browser controls are bypassable. Current third-party endpoints must enforce their own capacity controls. A future first-party test service needs server-minted sessions and edge quotas. |
| Database leakage | High | No raw IP or exact coordinates; HMAC reporter/audit keys; short-lived reports; deletion capability; TLS required; parameterized SQL; `PUBLIC` privileges revoked; optional least-privilege role and RLS script | Database operators can see coarse reports and notes. Apply role script in staging first, audit provider backups, and test restoration/retention. |
| Deployment-token or secret theft | Critical | Secrets only in server environment; `.env*` ignored except placeholder template; no secret values in source; least-permission CI workflows | GitHub/Vercel account controls cannot be verified locally. Require MFA, protected environments, short-lived tokens, audit review, and rotation drills. |
| CI/CD or dependency compromise | High | Lockfile, `npm ci`, type/lint/test/build gates, production dependency audit, CodeQL workflow, Dependabot, limited GitHub token permissions | Action tags and npm packages remain supply-chain trust. Review updates, consider immutable action SHA pins, and enable branch protection/settings manually. |
| SQL injection | High | All database calls use postgres.js tagged templates; no user-built SQL identifiers | Retest on every query change. Database credentials still determine blast radius. |
| XSS and HTML injection | High | React text escaping; report notes are never public; markup/links/contact data rejected in notes; CSP; no `eval` or user HTML rendering found | The shadcn chart helper uses `dangerouslySetInnerHTML` for developer-owned CSS-variable names only. Keep chart config static and covered by review. |
| SSRF | High | Provider source URL accepts only public HTTPS-looking destinations and is never fetched by NetPulse; Turnstile uses a fixed endpoint | Syntactic hostname checks do not defeat DNS rebinding if fetching is added later. Any future server fetch needs DNS resolution checks, redirect limits, and egress allowlists. |
| CSRF and CORS abuse | Medium | APIs set no permissive CORS; mutations require JSON content type; no cookie authentication; browser requests omit credentials; admin requests are signed; maintenance uses Authorization | If accounts/cookie sessions are introduced, add same-site cookies, origin checks, and anti-CSRF tokens before protected mutations. |
| Signed-request replay | High | HMAC over timestamp, nonce, and exact body; five-minute window; nonce stored transactionally for ten minutes; timing-safe comparison | Rotate ingestion keys and alert on replay failures. The operator must protect signing clients. |
| Session theft / credential attacks | Low now | No accounts, passwords, or authenticated browser sessions exist | Reassess before accounts. Do not infer that current non-applicability is a permanent control. |
| Command injection / path traversal / file upload | Low now | No shell execution, dynamic filesystem access, or upload endpoint found | Reassess if report uploads, exports processed server-side, or image/file features are added. |
| Open redirect and header injection | Medium | No redirect endpoint; external source URLs are validated; response headers are constant; control characters removed from user text | External links must retain `rel="noreferrer"`; future redirect parameters need strict allowlists. |
| Prototype/parameter pollution and mass assignment | Medium | Unknown JSON is validated field-by-field and reconstructed; byte/content-type limits | Continue avoiding object spreading of request bodies into database/domain objects. |
| IP and location exposure | High | Full IP is transient; only purpose-separated HMACs stored; no raw IP/coordinates in schema; region is city/subdivision/country and labeled approximate | Vercel/Cloudflare infrastructure may retain security/access logs under their settings. Configure retention and document processor terms. Small regions and rare ISPs can still aid inference. |
| Public-share leakage | Medium | Black Box share payload is client-only, excludes IP, and enforces a seven-day expiry during import | URLs and copied payloads can leak before expiry. Do not add server-hosted public shares without unpredictable tokens, access logs, deletion, and server-enforced expiry. |
| Scraping | Medium | Area aggregates suppress fewer than three reporters; notes and reporter identifiers never leave the server | Published aggregates are public by design. Rate-limit reads only if operationally justified; do not claim public data cannot be copied. |
| DDoS | High | Serverless platform and proposed Cloudflare controls; small request limits; short external-call timeout; bounded queries | Application code cannot absorb volumetric attacks alone. WAF/rate/DDoS controls and origin architecture must be configured in the hosting accounts. |
| Insider/admin misuse | High | Signed ingestion, purpose-scoped audit keys, audit rows with expiry, server-only credentials, no browser admin route | Enforce individual accounts/MFA, least privilege, break-glass process, production approvals, and periodic access review outside this repository. |
| Official-status impersonation | High | Only HMAC-signed ingestion can create `official=true`; exact public HTTPS source; nonce anti-replay | A stolen signing key can publish false official notices. Separate signing key from maintenance/database secrets and rotate immediately on suspicion. |
| Availability/circuit failure | Medium | Five-second Turnstile timeout; storage failures return generic 503; Area Pulse fails closed; speed testing remains independent | No distributed circuit breaker exists. Monitor dependency error rates and disable reporting safely when dependencies degrade. |
| Trademark/license misuse | Medium | AGPL-3.0-only license, NOTICE, trademark policy, contribution/security documents, non-affiliation statement | License and trademark enforcement are legal/operational processes, not anti-copy technology. Qualified legal review is required. |

## Code review findings

- No hard-coded credentials, private keys, database URLs, shell execution, dynamic filesystem access, `eval`, debug backdoor, or upload route was found in the reviewed source.
- `dangerouslySetInnerHTML` appears only in the vendored-style shadcn chart component and builds CSS from static developer configuration. It must never receive user-controlled keys or values.
- Area Pulse initially treated two Cloudflare request categories as independent corroboration. That confidence elevation was removed; only genuinely independently operated evidence may set that flag.
- Area Pulse initially accepted fallback forwarding headers as its rate-limit identity input. It now fails closed unless Vercel's platform-specific forwarded-for header is present.
- CSP disallows `unsafe-eval`. `style-src 'unsafe-inline'` remains because the current React/chart/component stack emits inline style attributes. This is a documented medium residual risk; migrate to nonces/hashes or extracted styles when practical.
- Authentication, session, password reset, MFA, account enumeration, and admin browser-route tests are not applicable because NetPulse has no accounts or browser admin session. They become release blockers if accounts are introduced.
- Cloudflare account settings, GitHub branch rules, Vercel protected environments, production database roles, backups, and restore success cannot be proven from source code.

## Release gates

Area Pulse reporting must remain unavailable until all of these are true:

- A staging PostgreSQL database exists, migration and least-privilege role are applied, and policy tests pass.
- A verified backup and staging restore are recorded.
- Turnstile production keys and an exact expected hostname are configured.
- Cloudflare/WAF or equivalent API rate rules are active and tested without blocking accessibility tools.
- Production secret ownership, rotation, logging, and environment access are reviewed.
- CI passes and required checks/production approvals are enabled.
- Privacy, terms, acceptable use, trademark, and accessibility drafts receive qualified legal review.

## Out of scope / not claimed

No destructive penetration test, production database migration, Cloudflare account mutation, branch-protection mutation, credential rotation, staging deploy, or production deploy is represented by this document. The audit does not establish regulatory compliance, legal sufficiency, or immunity from attack.
