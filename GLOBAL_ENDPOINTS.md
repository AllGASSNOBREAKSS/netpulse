# NetPulse global endpoints

NetPulse does not currently operate a worldwide test-server fleet. The checked-in directory contains one active Cloudflare anycast fallback; every named NetPulse region is `planned`. The fuller rollout, capacity, abuse, privacy, and observability design is in [GLOBAL_NETWORK.md](GLOBAL_NETWORK.md).

## Current supported directory

`public/network/endpoints.v1.json` is the source of truth. Its active endpoint supports browser HTTPS download, upload, latency, and provider trace requests. It does not provide a NetPulse-controlled echo protocol, endpoint health, capacity, active-test count, received-byte receipt, or compatible engine-version report. Anycast chooses a provider edge; that edge is not necessarily the geographically nearest server and is not the user's location. The isolated validation endpoint implements the contract locally but is not public regional coverage.

The regions US East, US Central, US West, Canada, Brazil, United Kingdom, Western Europe, Eastern Europe, Middle East, India, Southeast Asia, Japan, South Korea, Australia, and Africa are not advertised as active NetPulse coverage.

## Required regional contract

Before an endpoint can become active, it must expose reviewed and abuse-bounded interfaces for:

- exact-length, incompressible, `no-store` download payloads;
- bounded upload with a response that acknowledges the actual body bytes received;
- low-payload latency probes;
- a controlled WebSocket echo for application delivery/lateness plus an independently validated unreliable WebRTC data-channel protocol before a packet-loss percentage is reported;
- explicit, CORS-exposed transport headers for any claimed TCP RTT, QUIC RTT, or retransmit telemetry;
- health, drain state, utilization, capacity headroom, active tests, protocol version, and build version;
- IPv4 and IPv6 capability stated separately and tested from real clients;
- signed or otherwise integrity-protected discovery/session limits where justified.

The service must enforce per-IP and per-session limits, stream and body ceilings, cooldowns, regional bandwidth budgets, timeouts, overload rejection, data minimization, and short operational retention. Payload bodies must never be stored.

## Selection algorithm

Candidates first pass schema, protocol-version, capability, status, freshness, and reachability checks. Deep probes use multiple HTTPS samples. Current ranking weights median latency 35%, P95 latency 10%, jitter 10%, probe consistency 15%, reported health 15%, load 10%, and capacity headroom 5%, then multiply by probe availability. Unknown telemetry is penalized; geography alone never selects a server.

The engine retains a primary candidate and compatible backups. Unhealthy, draining, stale, unreachable, or incompatible entries are rejected or heavily penalized. When a backup exists, a bounded secondary download records agreement or disagreement without averaging or replacing the primary result. If no independently reachable backup exists, the Accuracy Passport says verification is unavailable.

## Activation and failover gates

A region remains planned until it independently passes:

1. Functional download/upload/latency/echo and IPv4/IPv6 checks.
2. Capacity tests above the maximum public profile with concurrent users.
3. Controlled bandwidth, RTT, jitter, loss, asymmetry, saturation, overload, and endpoint-failure matrices.
4. Real browser/device tests from the claimed geography and multiple ISPs.
5. Result-error, completion, confidence-calibration, data-use, and cost gates.
6. Health removal, draining, regional fallback, version rollback, rate-limit, DDoS, and privacy exercises.
7. Monitoring and alerts for errors, tail latency, utilization, bandwidth, failures, confidence shifts, regional variation, and cost per test.

Failover must choose another validated compatible endpoint and clearly disclose the region change. When all candidates are constrained, the engine must degrade gracefully or stop; it must not mistake endpoint overload for a slow subscriber connection.

## Rollout order

The proposed first pilot is a small, independently validated set based on real traffic and peering—not the entire region list. Expansion requires demonstrated demand, capacity, routing diversity, cost controls, and the same validation gate. No planned region should be activated merely by changing its directory status.

## Privacy boundary

Endpoint logs must mask or irreversibly pseudonymize addresses, avoid exact location, separate anonymous operational data from any future account data, use coarse regional aggregation, and retain only what operations require. NetPulse does not claim universal legal compliance; regional launch requires qualified legal and privacy review.
