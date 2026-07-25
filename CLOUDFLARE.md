# Cloudflare protection plan

These are **recommended account-level controls, not controls proven to be configured**. Apply them only after confirming the production traffic path, plan capabilities, DNS ownership, origin behavior, and accessibility impact.

## Turnstile

Area Pulse report submission renders Turnstile only when the API confirms the complete reporting stack is configured. The server calls Siteverify with a five-second timeout and requires success plus the exact `area-pulse-report` action and configured production hostname. Tokens are never accepted client-side alone. Do not challenge normal speed tests by default.

Configure production widget hostname restrictions and separate non-production keys. Monitor invalid/expired/replayed token ratios without logging tokens.

## Proposed edge rules

- Apply managed WAF rules to public pages and `/api/*`, initially in log/managed mode where false-positive risk is uncertain.
- For `POST /api/area-pulse/report`, enforce a small body limit, JSON content type, per-IP burst limit, and sustained limit below the application's 5/hour and 20/day database limits. Challenge suspicious bursts; do not cache.
- For `DELETE /api/area-pulse/report`, rate-limit repeated failures and never cache.
- For provider ingestion and maintenance, allow only POST/GET respectively, never cache, and add tight rate controls. Signed HMAC/nonce or bearer authentication remains mandatory even behind Cloudflare.
- Cache hashed static assets normally. Do not cache location-dependent Area Pulse context/incidents at a shared edge unless the cache key includes all coarse-region inputs and privacy review approves it.
- Enable DDoS and bot signals supported by the account, but avoid blanket geographic/ASN blocks without incident evidence. Shared networks, VPNs, assistive technology, and privacy relays can resemble abuse.

## TLS and origin

Use modern TLS, HTTPS redirects, valid origin certificates, and strict origin verification. If the custom domain is proxied through Cloudflare, prevent direct origin bypass where the hosting architecture permits it (for example, authenticated origin pulls or an origin allowlist). A Vercel deployment URL may remain directly reachable; verify the chosen architecture instead of claiming Cloudflare covers traffic that bypasses it.

## Headers and logging

The repository sets CSP, HSTS, referrer, permissions, MIME-sniffing, and framing controls. Ensure Cloudflare does not weaken or duplicate them inconsistently. Redact request bodies, authorization/signature headers, Turnstile tokens, deletion tokens, and query secrets. Set access/WAF log retention intentionally and reflect it in [PRIVACY.md](PRIVACY.md).

## Verification

Test legitimate desktop/mobile, keyboard-only, screen-reader, VPN/privacy-relay, shared-NAT, IPv4/IPv6, slow-network, and Turnstile failure paths in staging. Confirm bypass-host behavior, rate thresholds, no cached regional cross-leakage, origin certificate validation, and incident rollback before production.
