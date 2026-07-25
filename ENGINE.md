# NetPulse measurement pipeline (v4 local)

This document is the reference for **what NetPulse measures and how**. It is the
honest contract behind every number the UI shows.

> **NetPulse does not try to match Ookla, Fast.com, Cloudflare's own test, or
> M-Lab.** Those platforms use different servers, server counts, connection
> counts, and aggregation methods, so their numbers legitimately differ from
> each other and from NetPulse. We document our method and let the results
> stand on it.

## Pipeline stages

Each stage is a separate module under `src/lib/`. The orchestrator
(`engine.ts`) sequences them and streams events to the UI.

| # | Stage | Module | What it produces |
|---|-------|--------|------------------|
| 1 | Preflight | `preflight.ts` | Browser, OS, device class, tab foreground state, secure context, three family-specific IPv4/IPv6 HTTPS timings, connection type, explicit Cloudflare WARP signal where reported, other VPN/proxy status **unknown**, estimated duration + data |
| 2 | Server selection | `globalNetwork.ts` + `servers.ts` | Validates a versioned HTTPS endpoint directory; shallow/deep probes compatible candidates; rejects disabled, draining, stale, unavailable, and version-incompatible nodes; ranks latency, jitter, probe consistency, reachability, live health, load, and capacity; retains backups; explains degraded selection |
| 3 | Idle latency | `latency.ts` | 14 (10 low-data) zero-byte probes, `performance.now()` timed → min / median / mean / interquartile mean / p90 / p95 / p99 / jitter / stddev / failed / count |
| 4 | Download | `capacityClient.ts` + measurement worker | Discarded warm-up; adaptive 1 → 2 → 4 → 6/8 ramp; maximum capacity plus reliable stable-window and single-stream results; exact request diagnostics |
| 5 | Upload | `capacityClient.ts` + measurement worker | Discarded generated-payload warm-up; bounded adaptive 1 → 2 → 4 ramp; maximum and reliable results; provider byte receipt retained only when exposed |
| 6 | Loaded latency | measurement worker | Lightweight probes **during** download and upload, kept separate |
| 7 | Echo and UDP reachability | `packetloss.ts` | Controlled WebSocket message delivery when an endpoint advertises it, otherwise an **experimental** WebRTC/STUN reachability check. Neither is relabeled as network packet loss |
| 8 | Bufferbloat | `grading.ts` | Loaded − idle latency rise, **separate** for download and upload, graded A–F |
| 9 | Stability | `grading.ts` | 0–100 score from loaded-latency spread, spikes, worse down/up throughput variation, failed probes/requests, and completion; p95/p99; longest spike; probe completeness |
| 10 | Network identity | `engine.ts` + `networkIdentity.ts` | Automatic trace: serving edge, client country code, IP family, **masked** IP. ISP/ASN/city/region: validated, explicit opt-in lookup only |
| 11 | Transport telemetry | `transportTelemetry.ts` | Browser `nextHopProtocol` plus explicitly exposed server TCP/QUIC RTT/retransmit headers; missing server telemetry remains unavailable |
| 12 | Multi-server verification | `secondaryVerification.ts` | A bounded secondary download when an independently probed backup exists; agreement/disagreement is shown and incompatible results are never averaged |
| 13 | Confidence | `confidence.ts` | 0–100 trust score with exact visible deductions for sampling, variation, server stability, secondary disagreement, tab visibility, completion, and errors |
| 14 | Accuracy Passport | `accuracyPassport.ts` | Run/version IDs, confidence reasons, client/endpoint/transport facts, family comparison, secondary verification, data, duration, streams, sample and retry counts |
| 15 | Export/local evidence | `export.ts` + `evidenceStore.ts` | Full JSON plus privacy-filtered raw events and phase journal; latest 20 complete runs retained only on-device in IndexedDB |

## Timing

All timing uses `performance.now()` — monotonic and sub-millisecond, unaffected
by wall-clock adjustments. Latency probes are zero-byte HTTPS round-trips; these
read slightly higher than raw ICMP ping because they include TLS/HTTP framing.

## Throughput method

- **Warm-up and adaptive sizing**: each direction performs a discarded transfer
  to prime connection setup and selects a bounded request payload targeting a
  useful transfer duration. Warm-up bytes are counted in data use but excluded
  from the timed throughput result.
- **Cache-busting**: every transfer carries a monotonic unique query string and
  `cache: "no-store"` so a cached body cannot become a measurement.
- **Adaptive stream ramp**: one stream establishes per-flow behavior, then the
  worker tries 2, 4, 6, and 8 streams while aggregate throughput continues to
  improve. A short warm-up can size requests but cannot cap later concurrency.
- **Browser connection limit**: a "stream" is one concurrent Fetch request.
  The browser may multiplex several requests over one HTTP/2 or HTTP/3
  transport connection. NetPulse does not claim eight independent TCP/QUIC
  connections; that requires multiple validated endpoint origins, which are
  not deployed today.
- **Maximum Capacity**: total application payload across every stream divided by
  one shared monotonic stage window. Only stages that reach the configured
  comparison duration qualify when at least one such stage exists; otherwise
  the result is retained with an explicit data-cap limitation.
- **Reliable Throughput**: the median of the stable half of real 500 ms windows
  from the highest completed stage using at most four streams. P5, P95, peak,
  variation, and the single-stream result remain separate.
- **Measurement isolation**: fetch streaming and throughput statistics run in a
  Web Worker. React receives throttled progress targets at most every 100 ms;
  gauge RAF interpolation never defines or changes measurement timing.
  Upload random-body generation occurs before the shared stage clock and one
  incompressible body is reused across that stage. Upload observations update
  only after a POST succeeds because Fetch does not expose byte-level upload
  progress. An allowlisted provider received-byte header is used when exposed,
  but it does not provide NetPulse-controlled server receive timing or a
  cryptographically verifiable receipt. Otherwise the value is successfully
  submitted payload.
- **Direction isolation**: download and upload run sequentially so each loaded-
  latency result can be attributed to one direction. Running them concurrently
  would be a different full-duplex stress test and would not make either
  directional capacity estimate more comparable to other services.
- **Worldwide scope**: the checked-in endpoint directory currently contains
  only Cloudflare anycast. All requested NetPulse-operated regions remain
  explicitly planned and unsupported. The client can discover and manually
  select future compatible endpoints, but it does not claim regional coverage
  until those endpoints pass the independent gate in `GLOBAL_NETWORK.md`.
  BGP routing, peering, congestion, device limits, and methodology vary by ISP.
  NetPulse does not use private Ookla or Netflix endpoints and cannot promise
  identical results.
- **Ramp stopping**: the next stream stage runs only while aggregate throughput
  improves by at least 5%, bounded by the selected duration and application-byte
  budget. This is a saturation search, not a promise that the browser or endpoint
  can certify every multi-gigabit link.
- **Caps and stop reasons**: every phase has a hard duration cap and a payload
  target. Results retain whether a phase stopped because samples stabilized, the
  duration expired, the payload cap was reached, or all workers completed.
  Payload-capped phases that miss the minimum duration lose confidence. In-flight
  requests can overshoot slightly; displayed data is application payload
  including warm-ups, not exact on-wire usage.
- **High-speed budget**: in the five-stage Full download ramp, 65% of the
  configured payload budget is reserved for the final eight-request stage.
  This allows roughly four seconds at approximately 1 Gbps instead of
  exhausting the data cap before the nominal stability window.
- **Compression**: a response that explicitly reports a non-identity
  `Content-Encoding` is rejected; it is never presented as link capacity.
- **Upload limitation**: Fetch exposes neither byte-level upload progress nor
  protocol overhead. The fallback provider can expose a received-byte count,
  but not the complete NetPulse upload receipt in `TEST_NODE_PROTOCOL.md`.
  Upload is acknowledged/submitted payload divided by phase time. Median, peak
  observation, and variation use cumulative successful-response observations
  and are labeled as such rather than packet-level windows.

## Echo and UDP reachability — why packet loss remains unavailable

True packet loss requires a sustained unreliable datagram flow against a
cooperating echo/TURN service. Estimating it from failed HTTP requests would be
**wrong**. A compatible lab endpoint now offers a controlled WebSocket echo that
counts sent, received, late, and observably reordered application messages.
Because WebSocket runs over reliable TCP, retransmission hides network packet
loss; its delivery-loss percentage is never called packet loss. Without that
endpoint, WebRTC/STUN reports only UDP egress reachability and ICE-gathering
time. A public packet-loss percentage remains unavailable until an unreliable
WebRTC data-channel protocol passes independent packet-accounting validation.

## Health score

The 0–100 score is defined in **one** file, `src/lib/scoring.ts`, as seven
weighted components: download 24, upload 16, idle latency 12, loaded
latency/bufferbloat 20, jitter 8, stability 8, and run confidence 12. Packet
loss appears as an explicit zero-weight, unscored row because no valid loss
measurement exists. Clicking the score renders the same inputs, rules, and
earned/possible points that the calculation uses.

## Privacy

The full public IP is **never** stored in results or exported — only a masked
form (`68.197.•••.•••`). Cloudflare's automatic trace supplies its serving edge
code and a client country code; neither is mislabeled as a city or retail ISP.
The Connection & Privacy view can optionally contact `ipwho.is` for ISP, ASN,
and approximate area. That request occurs only after an explicit click and the
UI discloses that the provider will see the requesting public IP. Returned IPs
are immediately masked and the metadata is not stored in history or exports.

## What NetPulse cannot do from a browser

SSID, Wi-Fi password, radio channel, signal strength, nearby networks, router
model, and the list of LAN devices are all inaccessible to a sandboxed web page.
NetPulse never claims otherwise. See [AUDIT.md](AUDIT.md) for the full honesty
review and [VALIDATION.md](VALIDATION.md) for the test matrix.

## Connection Black Box

The long-run monitor is a separate, low-data observability pipeline under
`src/lib/blackbox*.ts`. It records monotonic-scheduled HTTPS round trips,
controlled DNS-over-HTTPS transactions, Cloudflare edge and IP-family
observations, page visibility, and browser scheduling delay. It does not reuse
speed-test values or synthesize missing samples. Detailed modes, formulas,
incident thresholds, data budgets, persistence rules, exports, and browser
limitations are documented in [BLACKBOX.md](BLACKBOX.md).
