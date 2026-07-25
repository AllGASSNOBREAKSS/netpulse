# NetPulse global measurement network

Status: **architecture and client selection foundation only**. No NetPulse-operated regional measurement node is deployed. The production client continues to use Cloudflare's public anycast speed endpoint, with server load, capacity, and version explicitly unavailable.

This document is the deployment contract and independent-validation gate. A region must not be changed from `planned` to `pilot` or `supported` in `public/network/endpoints.v1.json` until the required data-plane service exists and the validation evidence below is attached to a release review.

## 1. Architecture

```text
Browser
  |
  | HTTPS, same-origin directory discovery
  v
NetPulse web/control plane (Vercel)
  |-- versioned endpoint directory (no secrets)
  |-- short-lived session-token issuer (future)
  |-- coarse operational aggregates (future, consented)
  |
  +---- direct HTTPS/UDP/QUIC; never proxy test payload through Vercel ----+
                                                                         |
                Regional data plane                                      |
     +----------------+  +----------------+  +----------------+          |
     | region A / AZ1 |  | region A / AZ2 |  | region B / AZ1 | <--------+
     | down / up      |  | down / up      |  | down / up      |
     | latency        |  | latency        |  | latency        |
     | echo           |  | echo           |  | echo           |
     | health/capacity|  | health/capacity|  | health/capacity|
     +----------------+  +----------------+  +----------------+
              |                 |                    |
              +------ metrics/logs/traces -----------+
                                |
                         operations backend
```

The UI/control plane and measurement data plane are deliberately separate. Vercel Functions have a 4.5 MB body limit and cannot act as WebSocket servers, so they are unsuitable for sustained high-volume throughput or stateful echo traffic. Regional test payloads must flow directly between the browser and dedicated measurement nodes.

## 2. Endpoint contract

Every NetPulse-operated endpoint must provide, over IPv4 and IPv6 where the provider supports both:

| Endpoint | Contract |
| --- | --- |
| `GET /v1/latency` | Empty or tiny no-store response; timing-only; CORS restricted to approved NetPulse origins |
| `GET /v1/download?bytes=N` | Incompressible streamed bytes; exact application byte count; no compression; bounded `N` |
| `POST /v1/upload` | Reads and discards the complete bounded body before acknowledging accepted bytes; never stores payload |
| `POST /v1/session` | Future short-lived signed grant containing region, byte, stream, duration, and expiry limits |
| `GET /v1/health` | Versioned JSON described below; not cached beyond its expiry |
| UDP/TURN/WebTransport echo | Sequence-numbered controlled echo for loss, duplication, reordering, and RTT; unavailable until deployed |

Required response headers include explicit CORS, `Cache-Control: no-store`, content type, protocol version, server version, request ID, and server processing time. Download responses must disable content encoding so application bytes are not confused with compressed wire bytes. No endpoint may return a precomputed speed or client diagnosis.

Health schema fields are validated by `src/lib/globalNetwork.ts`:

```json
{
  "status": "healthy",
  "checkedAt": "2026-07-21T10:00:00Z",
  "expiresAt": "2026-07-21T10:01:00Z",
  "loadPct": 32,
  "capacityMbps": 25000,
  "availableCapacityMbps": 17000,
  "activeTests": 21,
  "maxConcurrentTests": 120,
  "serverVersion": "1.0.0",
  "protocolVersion": 1,
  "reason": "Within operating limits"
}
```

Load and capacity must come from measured node/network telemetry, not static configuration. A stale, malformed, unavailable, draining, or protocol-incompatible report cannot be treated as healthy.

## 3. Rollout plan

The region labels below describe product coverage areas, not contractual geopolitical boundaries.

### Pilot wave 1

- US East
- Western Europe
- Southeast Asia
- Australia

This four-region pilot gives geographically diverse routes and directly addresses the currently unvalidated Australia path. It is a proposal, not live coverage. Each pilot should start with two failure-independent nodes across zones. At least US East and Western Europe should include a second provider endpoint during validation so provider-specific congestion can be detected.

### Expansion wave 2

- US Central and US West
- United Kingdom
- India
- Japan

### Expansion wave 3

- Canada
- Brazil
- Eastern Europe
- Middle East
- South Korea
- Africa, with the first city selected from consented traffic demand, peering data, and real probe results rather than a continent centroid

Expansion gates are completion rate, route diversity, regional demand, sustained utilization, cost per completed test, and support evidence. A planned region remains visibly unsupported until it passes the release gate.

## 4. Discovery and server selection

The browser loads `/network/endpoints.v1.json` or the HTTPS URL in `VITE_NETPULSE_ENDPOINT_MANIFEST_URL`. The parser rejects unknown schema versions, duplicate IDs, insecure URLs, missing core capabilities, and mismatched health declarations. Failure falls back to the built-in Cloudflare entry and is disclosed in the result.

Selection uses two passes when more than four endpoints exist:

1. One shallow HTTPS probe to every non-disabled directory entry.
2. Deep probes to the best four reachable candidates plus a manual choice, if any.
3. Reject draining, unavailable, stale-health, and protocol-incompatible nodes.
4. Rank the remaining endpoints.
5. Select the best endpoint unless the user chose a reachable compatible endpoint manually.
6. Retain the next two endpoints as failover candidates.

Current score:

```text
rank = reachability * (
  0.40 * relative median latency
  + 0.15 * jitter score
  + 0.15 * observed RTT consistency
  + 0.15 * health score
  + 0.10 * load headroom
  + 0.05 * capacity headroom
)
```

Unknown health/load/capacity receives a cautious score of `0.65`, not a healthy score. `route consistency` means consistency of browser-observed HTTPS probes; browsers cannot run traceroute, inspect BGP, or prove that packets used the same route. Approximate distance remains unavailable unless a documented coarse client region and documented server location are both present.

Geographic distance is explanatory metadata only and never the primary selector. A nearby overloaded or poorly routed node should lose to a slightly farther healthy node.

## 5. Failover and overload behavior

Implemented client behavior:

- Directory timeout and schema failure fall back to the built-in endpoint.
- Failed probes remove endpoints from primary selection for that run.
- Disabled, draining, unavailable, stale-health, and incompatible nodes cannot become the automatic primary.
- Up to two reachable backups are retained and displayed.
- A run is labeled degraded when it lacks an independent backup or current health/load/capacity telemetry.

Required before pilot deployment:

- Retry endpoint discovery once with bounded exponential backoff.
- If the chosen node fails before measured traffic begins, move to the best backup.
- If it fails after a throughput phase begins, mark the run incomplete; never combine bytes from different nodes into one headline result. Offer a fresh run on the backup.
- Control plane removes a failed node after consecutive probes from at least two independent monitors.
- Draining stops new grants while allowing existing sessions to finish.
- Global directory changes use canary publication and rapid rollback.
- Alerting pages an operator; it must not rewrite user results.

## 6. Adaptive test limits

The current browser engine already adapts request payload size from a measured warm-up, limits duration and bytes, supports low-data mode, uses one and multiple streams separately, and stops stable downloads early. It does **not yet prove** accurate operation below 1 Mbps or above 1 Gbps, and fixed stream maxima still require controlled validation.

Target policy for regional nodes:

| Observed pilot rate | Streams | Phase target | Request payload guidance |
| --- | ---: | ---: | --- |
| under 1 Mbps | 1 | 8–15 s | 64–256 kB; long timeout based on measured RTT |
| 1–25 Mbps | 1–2 | 6–10 s | 256 kB–2 MB |
| 25–250 Mbps | 2–4 | 5–8 s | 2–16 MB |
| 250 Mbps–1 Gbps | 4–6 | 6–10 s | 16–64 MB |
| above 1 Gbps | 6–8 only after device/server headroom checks | 8–12 s | 32–128 MB |

Satellite/high-RTT paths need RTT-scaled request timeouts, not a low-confidence zero. Mobile/low-power devices cap streams and payload allocation. A connection change, background tab, severe event-loop stall, exhausted server, or insufficient transferred bytes reduces confidence. No client may exceed the signed session grant even if its local profile requests more.

## 7. Abuse and scaling limits

Initial proposed guardrails, to be tuned from pilot evidence:

- One active full test per coarse abuse key; two completed full tests per 10 minutes.
- Up to six low-data tests per 10 minutes.
- 30-second full-test cooldown.
- Eight streams maximum per signed session; four until multi-gig validation passes.
- 350 MB application-payload ceiling for the current full profile; lower region-specific emergency caps allowed.
- 100 MB maximum individual upload request; smaller requests preferred.
- Two-minute signed grant lifetime with region, protocol version, byte budget, stream limit, and nonce.
- Per-session and per-IP/coarse-prefix token buckets at the edge; do not publish raw identifiers.
- Bot challenges only when risk signals justify them; accessibility-safe fallback required.
- DDoS protection at the provider edge plus origin ACLs, SYN/UDP flood protection, and strict request parsing.
- Overloaded nodes return an explicit retry/degraded response and set health to draining or unavailable. They must never serve a fabricated low speed.

Autoscaling uses network egress/ingress utilization first, then active tests, CPU, memory, event-loop delay, and error rate. Scale out before sustained interface utilization exceeds 50–60%; stop admitting tests before 80%. Nodes must advertise measured available capacity, not nominal VM marketing bandwidth.

## 8. Capacity and cost estimation

For `T` completed tests per hour and mean application payload `D` MB:

```text
monthly transfer TB ≈ T * 24 * 30 * D / 1,000,000
average data-plane Gbps ≈ T * D * 8 / 3,600,000
peak provisioned Gbps >= peak concurrent measured Mbps / target utilization
cost per completed test = regional compute + transfer + load balancer + observability + TURN/echo / completed tests
```

Example planning envelope, not a forecast: 1,000 tests/hour at 250 MB averages roughly 250 GB/hour, 180 TB/month, and 0.56 Gbps continuously before protocol overhead. A 10x peak and multi-gig users require substantially more headroom.

Each pilot region should start with two independent nodes, at least 8 vCPU/16 GB RAM, memory-generated payloads, and measured 10 Gbps networking. A region claiming reliable 2.5 Gbps tests should use 25 Gbps-class interfaces or equivalent measured headroom and demonstrate that two concurrent 2.5 Gbps clients do not depress either result. These are validation requirements, not a provider purchase recommendation.

## 9. Privacy and data separation

- Full public IP is processed transiently for routing and abuse controls and masked in the UI and exports.
- Operational identifiers use rotating, region-separated HMAC keys; raw IP is not written to analytics.
- Location is coarse and IP-derived, labeled approximate, and never stored as exact coordinates.
- Anonymous measurement telemetry is stored separately from account data and cannot be joined by default.
- Raw payload bodies are discarded; payload contents and URLs are not logged.
- Default operational retention target: raw request logs 24–72 hours, coarse aggregates 30 days, security evidence only as long as justified. Exact periods require legal and operational approval per region.
- Opt-in is required before uploading result summaries beyond what is necessary to execute the requested test.
- Users receive privacy-safe export and deletion controls for persisted data.
- Data residency, cross-border transfer, consent language, child protection, accessibility, and retention need qualified legal review before each regional launch. NetPulse does not claim universal GDPR, CCPA, LGPD, PIPEDA, or other compliance merely because these controls exist.

## 10. Observability and alerts

Per endpoint and region:

- discovered, started, completed, cancelled, and failed tests
- completion rate and phase-specific error rate
- probe median/P95/P99 latency and jitter
- download/upload request failures and accepted bytes
- echo session failures, loss, reordering, and duplication when echo exists
- interface ingress/egress, available bandwidth, CPU, memory, active sessions, queue depth
- median confidence and reasons for confidence deductions
- IPv4/IPv6 success split
- region/provider result variation from controlled probes
- directory/health version mismatch
- transferred bytes and cost per completed test

Page on sustained overload, capacity-report disagreement, falling completion rate, elevated phase failures, health staleness, protocol mismatch, large controlled-probe divergence, or one address family failing. Alerts indicate infrastructure risk; they never alter measured client values.

## 11. Independent validation gate

Each endpoint must be tested from at least three networks outside its provider and one second cloud provider. Evidence must include:

- nearby and distant routes
- single-stream and multi-stream results
- IPv4 and IPv6
- below 1, 10, 100, 500 Mbps, 1 Gbps, and 2.5 Gbps controlled shaping
- high RTT, jitter, reordering, loss, asymmetry, and saturation
- Wi-Fi, Ethernet, mobile, VPN, satellite-like latency, restricted corporate proxy, and low-power device
- parallel clients until admission control activates
- node drain, health expiry, directory failure, version mismatch, and regional failover
- byte accounting at browser, server, and network interface
- comparison against at least two independent tools/providers with methodology differences documented, never numerically forced

Pass criteria are defined per profile before testing. At minimum: no fabricated values, byte accounting reconciles within documented protocol overhead, incompatible/overloaded nodes cannot be selected, failures are explicit, and repeated controlled runs meet the declared error and variance envelope.

## 12. Current validation result and unsupported coverage

Validated locally:

- directory and health schema validation
- insecure URL and duplicate-ID rejection
- health freshness and protocol compatibility handling
- latency/jitter/reachability/load/capacity-aware ranking
- overloaded and unavailable endpoint rejection
- backup selection data model and manual preference UI
- degraded single-provider disclosure

Not validated because no NetPulse regional data plane exists:

- actual regional download/upload/latency/echo service
- regional IPv4/IPv6 and provider diversity
- live health, capacity, autoscaling, admission control, or cost telemetry
- packet loss, reordering, or duplication
- real geographic comparisons or global failover
- the complete shaped-link and physical-device matrix

Therefore all 15 requested NetPulse regions remain unsupported today. Global deployment is prohibited until the independent validation gate is completed.
