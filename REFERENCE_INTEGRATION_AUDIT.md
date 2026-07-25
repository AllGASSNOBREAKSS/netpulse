# NetPulse reference and integration audit

Audit updated: 2026-07-25
Policy: read-only methodology and architecture research; no referenced source
code was copied into the current NetPulse changes

## Why references are reviewed

Internet tests answer different questions. Studying public methods prevents
avoidable mistakes, but reproducing a competitor's displayed number is not an
accuracy strategy. NetPulse adopts general, publicly documented engineering
patterns only when they fit a browser-first, independently specified system.

## Service and standards comparison

| Reference | Public evidence | Useful pattern | NetPulse decision |
| --- | --- | --- | --- |
| Ookla Speedtest | Multiple connections, adaptive chunks/buffers, extra connections during the first half, time-bounded phases, candidate latency selection | Adaptive saturation and server probing | Independently implement; no private protocol/API, result forcing, or affiliation |
| FAST.com | Series of downloads/uploads against Netflix servers; estimates maximum speed; loaded/unloaded latency | Keep capacity distinct from loaded responsiveness | Do not use undocumented Netflix APIs or call Netflix CDN results universal truth |
| Cloudflare Speedtest | Browser Resource Timing, increasing payload sizes through 250 MB, loaded-latency probes, configurable 90th percentile bandwidth, TURN-backed packet loss when configured | Browser-oriented request ramp and cooperating unreliable echo | Current endpoint use is direct and documented; no claim that NetPulse controls or capacity-certifies it |
| M-Lab NDT7 | Locate-selected server, secure WebSocket, single TCP connection, client and server measurements, server TCP_INFO | Versioned protocol, server-side byte/duration evidence, validation adapter | Keep NDT7 comparison separate; single-flow semantics are not NetPulse multi-request capacity |
| Broadband Forum TR-143 | HTTP/FTP diagnostics, time/file modes, IPv6, multiple connections with per-connection status, explicit whole-test failure | Retain per-request evidence and explicit failure | Browser NetPulse is not a CPE/TR-143 conformance implementation |
| Broadband Forum TR-471 | Maximum IP-layer capacity as a defined metric separate from application throughput | Product categories must name measurement layer | NetPulse currently reports application throughput, not IP-layer capacity |

Primary sources:

- https://speedtest.zendesk.com/hc/en-us/articles/203845400-How-does-the-test-itself-work-How-is-the-result-calculated
- https://speedtest.zendesk.com/hc/en-us/articles/203845410-How-does-the-Begin-Test-button-select-a-server-
- https://fast.com/
- https://github.com/cloudflare/speedtest
- https://www.measurementlab.net/tests/ndt/ndt7/
- https://github.com/m-lab/ndt7-js
- https://www.broadband-forum.org/pdfs/tr-143-1-1-0.pdf
- https://www.broadband-forum.org/technical-library/?number=TR-471

## Open-source repository matrix

The audited commit identifiers below record the earlier read-only snapshots
used for the repository-level design review.

| Repository | Audited commit | License | Patterns reviewed | Excluded |
| --- | --- | --- | --- | --- |
| `henrywhitaker3/Speedtest-Tracker` | `8cb2e8a3236850b4a07e887ac376c0d4d5e804f4` | GPL-3.0 | queued execution, provider boundary, history, failure events | Ookla CLI execution, legacy defaults, UI/branding |
| `sivel/speedtest-cli` | `22210ca35228f0bbcef75a7c14587c4ecb875ab4` | Apache-2.0 | upload preallocation, bounded concurrency, cancellation, single/multi modes | Speedtest.net protocol and non-authoritative HTTP latency |
| `sindresorhus/speed-test` | `200dda1b649eb00864a183912a9720ce2def7ae3` | MIT | event-driven CLI progress and machine-readable output | `speedtest-net` dependency and Ookla service |
| `alexjustesen/speedtest-tracker` | `166a84a8f5561059a642d1d5943cc0b8bf667534` | MIT | staged jobs/status, normalized plus raw results, pruning, thresholds | fake-result generator, provider branding, CLI invocation |
| `cloudflare/speedtest` | current public repository reviewed 2026-07-25 | MIT | browser timing, payload ramp, loaded latency, TURN loss contract | no code incorporated; public service remains third party |
| `m-lab/ndt7-js` | current public repository reviewed 2026-07-25 | Apache-2.0 | located endpoint, secure WebSocket, client/server events, explicit data-policy gate | no dependency added; no test sent to M-Lab |

The current NetPulse tree does not add these packages or copy their source.
If later work incorporates code, the exact version, files, modifications,
copyright notice, license text, and distribution obligations must be reviewed
before the change is accepted.

## Current independent implementation

The local engine now independently implements:

- versioned pipeline states and a durable phase journal;
- cancellation propagated through browser operations;
- Web Worker capacity measurement and statistics;
- adaptive browser-request ramp and shared-window byte accounting;
- separate Peak Capacity, Reliable Throughput, and single-request results;
- pre-generated non-personal upload bodies;
- privacy-filtered per-request diagnostics;
- endpoint directory validation and explicit degraded mode;
- Accuracy Passport evidence and local-only history/evidence;
- unavailable packet loss when a suitable echo service does not exist.

These are general engineering patterns. The formulas and schemas are defined
by NetPulse in `NETPULSE_MEASUREMENT_SPEC.md`,
`TEST_NODE_PROTOCOL.md`, `SERVER_DISCOVERY_SPEC.md`, and
`ACCURACY_PASSPORT_SCHEMA.md`.

## Compatibility and terms boundaries

- Ookla and Netflix services are not integrated. Their private endpoints,
  tokens, EULAs, or APIs must not be reverse engineered or embedded.
- M-Lab use requires its current integration and data-policy requirements.
  A validation adapter must be opt-in, separately labeled, and ineligible to
  overwrite a NetPulse result.
- Cloudflare's public speed endpoint is a third-party dependency. Availability,
  terms, collection, and protocol behavior can change; it is not a substitute
  for a NetPulse-operated node contract.
- Broadband Forum documents are standards references; reading them does not
  create conformance.
- Trademarks and provider names remain the property of their owners. NetPulse
  is independent and makes no affiliation claim.

## Deferred integration decisions

1. Whether to add `@m-lab/ndt7` as a consented validation-only adapter.
2. Whether to reuse any MIT/Apache implementation code rather than continuing
   the clean independent node/client implementation.
3. Which providers and legal terms are acceptable for a US East node pilot.
4. Whether a TURN/WebRTC loss service can meet cost, abuse, privacy, and
   validation gates.

No decision above is authorized by this Phase 1 audit.
