# NetPulse measurement defect audit

Audit date: 2026-07-25
Scope: the current source tree, including the uncommitted local high-speed worker repair
Release status: local engineering work only; not committed, pushed, merged, or deployed

## Executive finding

NetPulse does not fabricate production speed-test values. The current local
engine measures browser-visible application bytes and HTTPS timings. It also
keeps packet loss unavailable when no suitable echo service exists, masks the
public IP before application storage, and labels IP-derived location as
approximate.

The system is not yet qualified as a globally accurate measurement platform.
It has one active Cloudflare anycast origin, no independently operated test
node, no capacity or load telemetry, no authoritative NetPulse upload receipt,
no provider-diverse consensus, and no completed controlled certification
matrix. A result therefore describes the browser's path to the selected
Cloudflare edge. It does not prove access-line rate, worldwide accuracy, or
equivalence to Ookla, FAST.com, Cloudflare's own product, M-Lab, or iperf3.

The reported iPhone discrepancies are valid defect evidence:

- historical NetPulse 325 Mbps versus Speedtest.net 1,042.69 Mbps;
- later NetPulse 596 Mbps versus Speedtest.net 755.02 Mbps and FAST.com
  900 Mbps.

The exact request-level cause of the historical results cannot be recovered
because deployed engine 3.1.0 did not retain per-request timing, protocol,
status, compression, receipt, or abort evidence. The old 220 MB download cap
could last only about 1.96 seconds at 900 Mbps and 1.76 seconds at 1 Gbps,
despite a configured four-second minimum. That contradiction, fixed stream
ceiling, short request turnover, and main-thread contention are proven defects
capable of materially depressing a high-speed browser result. They do not
prove which single defect produced exactly 325 or 596 Mbps.

## Current architecture

| Layer | Current implementation | Audit status |
| --- | --- | --- |
| UI | React/Vite dashboard, RAF-only gauge interpolation, throttled event consumption | Presentation is separated from formulas |
| Orchestration | Versioned phase journal in `src/lib/engine.ts` and `measurementPipeline.ts` | Real state transitions, retry and cancellation evidence |
| Capacity | Module Web Worker using `capacityCore.ts` | Local only; not the deployed public engine |
| Timing | `performance.now()` | Correct monotonic browser clock |
| Directory | Versioned, schema-validated endpoint manifest | One active Cloudflare fallback |
| Data plane | Direct browser requests to `speed.cloudflare.com` | No throughput traffic through Vercel |
| Persistence | Local IndexedDB evidence and localStorage history | Privacy-filtered, device-local |
| Validation | Unit/integration suite plus Docker/netem/iperf3 lab scaffolding | Structure tested; controlled matrix not executed |

## Endpoint audit

| Purpose | Current URL | What is known | What is unavailable |
| --- | --- | --- | --- |
| Download | `https://speed.cloudflare.com/__down?bytes={bytes}` | Exact application bytes read; cache-busted; compression rejected when declared | Endpoint load, available capacity, server build, independent route |
| Upload | `https://speed.cloudflare.com/__up` | Successful POST; provider's `cf-meta-upload-bytes` used when exposed | NetPulse-signed receipt and server-side receive duration |
| Latency | `https://speed.cloudflare.com/__down?bytes=0` | Complete HTTPS request timing | ICMP RTT, access-link-only latency |
| Trace | `https://speed.cloudflare.com/cdn-cgi/trace` | Masked public IP and serving edge where returned | Exact location; edge is not the user's city |
| Echo | None in the active directory | STUN UDP reachability can be attempted | End-to-end packet-loss percentage |

The endpoint manifest is served by the NetPulse web deployment, but download,
upload, latency, trace, STUN, and optional echo traffic is initiated directly
by the browser. Vercel is not a throughput proxy in the current architecture.

## Metric-by-metric audit

| Displayed or retained metric | Source and formula | Classification | Production reliability |
| --- | --- | --- | --- |
| Maximum download capacity | Maximum duration-qualified ramp stage; `sum(application bytes) * 8 / shared stage ms / 1000` | Direct browser measurement | Real for the selected path; not globally certified |
| Reliable download throughput | Median of the stable half of real 500 ms windows from the highest completed stage using at most four requests | Calculated from direct samples | Real, but limited when fewer than two windows exist |
| Single-stream download | Shared-window rate from the one-request stage | Direct browser measurement | Request stream, not proof of one TCP/QUIC connection |
| Maximum upload capacity | Successful/acknowledged application bytes over one shared stage window | Direct browser measurement | Provider receipt is used when exposed; otherwise client-success semantics |
| Reliable upload throughput | Median of stable-half cumulative successful upload observations | Calculated from direct observations | Coarser than download because Fetch exposes no upload progress |
| Idle latency | Median of sequential zero-byte HTTPS request durations | Direct browser measurement | Valid application RTT to selected endpoint; not ICMP |
| Download-loaded latency | Median of lightweight HTTPS probes completed during download load | Direct browser measurement | Direction-specific and real |
| Upload-loaded latency | Median of lightweight HTTPS probes completed during upload load | Direct browser measurement | Direction-specific and real |
| Idle jitter | Mean absolute difference between consecutive idle RTT samples | Calculated from direct samples | Valid for this HTTPS path and sample cadence |
| Bufferbloat | `max(0, loaded median - idle median)`, separately by direction | Calculated from direct samples | Valid path-specific rise; grade thresholds are product policy |
| Stability | 100 minus weighted spread, spike, throughput-variation, failure, and completion penalties | Product score | Transparent but not a standardized stability or uptime metric |
| Internet Health | Weighted throughput, latency, bufferbloat, jitter, stability, and confidence score | Product score | Transparent experience estimate; not measurement confidence |
| Result confidence | Observable penalty model starting at 100 | Heuristic product score | Explainable but not calibrated until the lab matrix runs |
| Packet loss | Always `null` on the public fallback | Unavailable | Correct; STUN and WebSocket message delivery do not replace it |
| UDP reachability | WebRTC ICE/STUN server-reflexive candidate observation | Experimental direct signal | Says only whether UDP/STUN appeared reachable |
| WebSocket message loss | Missing controlled echo messages over reliable TCP | Experimental application signal | TCP retransmission hides underlying network packet loss |
| IPv4/IPv6 comparison | Family-specific HTTPS reachability and latency probes | Direct browser measurement | Not a full per-family capacity test |
| ISP and ASN | Optional user-initiated `ipwho.is` response | Third-party estimate | Show only when returned; may name a transit/hosting network |
| Approximate location | Optional IP-derived city/region/country | Third-party estimate | Approximate only; never street-level |
| Public IP | Cloudflare trace, immediately masked | Direct observation, privacy transformed | Full value is not retained in result/history/export |
| Server/edge | Directory provider/region plus Cloudflare edge code | Direct metadata | Edge code is not user location; server city/distance can be unavailable |
| Transport protocol | Resource Timing `nextHopProtocol` when exposed | Browser observation | Often unavailable cross-origin |
| TCP/QUIC telemetry | Allowlisted cooperating-server headers only | Unavailable on fallback | Never inferred from browser throughput |
| History | Locally stored completed normalized results | Direct local record | Personal history, not population or ISP benchmarking |
| Diagnosis/impact ratings | Deterministic rules over measured evidence with confidence caps | Derived guidance | Must remain probabilistic; browser cannot identify router/RF/ISP cause |

No production `Math.random` measurement, random diagnosis, fixed fake speed,
fake packet loss, or simulated result was found. Web Crypto randomness is used
only to create incompressible non-personal upload payloads and identifiers.
Loading skeletons, copy-reset timers, request timeouts, and scheduler cadence
are presentation or control behavior, not measurement generators.

## Defects fixed by the local worker repair

1. Fixed download concurrency was replaced by an adaptive
   `1 -> 2 -> 4 -> 6 -> 8` ramp.
2. The warm-up no longer suppresses later concurrency stages.
3. Full download capacity increased to a 15-second/750 MB bound with a 64 MB
   request ceiling; 65% of the stage budget is reserved for the final stage.
4. Network reads and capacity statistics moved off the React main thread.
5. One shared monotonic stage window now covers total bytes across requests.
6. Maximum Capacity, Reliable Throughput, and Single-stream Throughput are
   separate values.
7. Upload random-body generation occurs before timed stage execution and the
   same body is reused.
8. Declared compression is rejected; exact download bytes are read from the
   response stream.
9. Provider upload-receipt bytes are used when exposed.
10. Every request records privacy-filtered timing, byte, HTTP, protocol,
    compression, receipt, outcome, and failure evidence.
11. Intentional loaded-probe cancellation at stage shutdown is not counted as
    a network failure.
12. UI progress is throttled and cannot alter measurement timing.

## Remaining measurement defects and blockers

### P0: blocks accuracy claims

1. **No independent NetPulse test node.** Cloudflare anycast is both the only
   path and the only capacity provider.
2. **No controlled certification.** The repository has no completed trials for
   the affected iPhone, controlled 100/500/1,000 Mbps, or multi-gigabit links.
3. **Upload truth is incomplete.** A provider byte-count header is useful, but
   NetPulse needs a versioned receipt containing bytes accepted and server
   monotonic start/end time.
4. **Confidence is not calibrated.** A penalty model can be internally
   consistent and still be statistically overconfident.
5. **No multi-server truth mode.** Abnormal results cannot be adjudicated
   across independently routed, capacity-validated providers.

### P1: limits comparability and diagnosis

1. Same-origin Fetch request count does not equal transport connection count
   under HTTP/2 or HTTP/3.
2. Resource Timing protocol and detailed phases may be hidden without
   `Timing-Allow-Origin`.
3. The browser cannot observe wire bytes, retransmissions, congestion control,
   Wi-Fi signal, router queues, or access-link rate.
4. Current reliable upload windows are cumulative completed-request
   observations, not byte-level time windows.
5. IPv4/IPv6 testing compares separate probe hosts rather than the same
   regional NetPulse node and does not run full capacity per family.
6. Diagnosis copy in some learning content overstates causal certainty (for
   example, calling evening degradation ISP congestion without independent
   evidence). This requires a later evidence-language pass.

### P2: operational and product limitations

1. Full mode may use roughly 903 MB plus bounded in-flight overshoot.
2. Backgrounding, Low Power Mode, thermal pressure, memory pressure, and
   browser scheduling can depress mobile results.
3. The application does not yet expose a user-controlled low-data budget
   negotiated with a dedicated node session.
4. One anycast edge cannot provide honest regional coverage or provider
   diversity.

## Competitor and standards comparison

| System | Publicly documented pattern | What NetPulse may adopt | What NetPulse must not claim or copy |
| --- | --- | --- | --- |
| Ookla | Time-bounded adaptive chunks and additional connections; server chosen after candidate latency tests | Adaptive saturation, bounded duration, explicit server probing | Private protocol, proprietary service behavior, or result parity |
| FAST.com | Multiple downloads/uploads to Netflix servers; reports an estimate of maximum available speed plus loaded/unloaded latency | Separate capacity and responsiveness concepts | Private Netflix APIs or CDN entitlement |
| Cloudflare Speedtest | Increasing request sizes, loaded-latency probes, high bandwidth percentile, TURN-backed loss when configured | Public MIT-licensed design ideas with attribution if code is reused | Treating the public endpoint as NetPulse-controlled or capacity-certified |
| M-Lab NDT7 | Located healthy server, WebSocket test, single TCP flow, client/server byte and duration evidence, server TCP_INFO | Server receipts, versioned protocol, independent validation adapter | Calling single-flow NDT7 a multi-flow capacity equivalent |
| Broadband Forum TR-143 | Time/file-based diagnostics, per-connection records, explicit failure, IPv6 support | Explicit connection results and all-or-failed semantics for certification | Claiming browser conformance to a CPE management standard |
| Broadband Forum TR-471 | Maximum IP-layer capacity is a separately defined target metric | Keep capacity distinct from application reliability | Call application bytes an IP-layer metric without protocol accounting |

Primary research sources:

- https://speedtest.zendesk.com/hc/en-us/articles/203845400-How-does-the-test-itself-work-How-is-the-result-calculated
- https://speedtest.zendesk.com/hc/en-us/articles/203845410-How-does-the-Begin-Test-button-select-a-server-
- https://fast.com/
- https://github.com/cloudflare/speedtest
- https://www.measurementlab.net/tests/ndt/ndt7/
- https://github.com/m-lab/ndt7-js
- https://www.broadband-forum.org/pdfs/tr-143-1-1-0.pdf
- https://www.broadband-forum.org/technical-library/?number=TR-471

## Required evidence to close the iPhone defect

The affected device must run the local engine at least five times in the
foreground, with low-power state and browser version recorded. Each run must
export its Accuracy Passport and stream diagnostics. At minimum, review:

- stage bytes, shared duration, request size, and concurrency;
- TTFB, transfer-only duration, protocol visibility, and request turnover;
- failed/aborted requests and loaded probes;
- compression/content-length/receipt evidence;
- worker use, foreground state, and confidence reasons;
- selected edge and a validated secondary endpoint when available.

The same device and network should then run controlled comparisons without
forcing numerical agreement. Differences must be explained by endpoint path,
capacity, stream topology, duration, payload, congestion control, browser
limits, and aggregation.

## Phase 1 decision

The local worker repair is architecturally sound enough to proceed to
controlled review, but NetPulse is **not approved for a global or gigabit
accuracy claim**. Phase 2 should stabilize the browser engine and honesty gates
against the normative specification. A dedicated test-node implementation
should begin only after the protocol and discovery specifications are reviewed.
