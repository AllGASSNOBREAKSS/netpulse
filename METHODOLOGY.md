# NetPulse measurement methodology

This document describes the browser measurement pipeline implemented in the current source tree. It is a method specification, not a claim that NetPulse has achieved a particular accuracy level worldwide. Controlled evidence belongs in `lab/results/` and the validation report; production or competitor runs are not substitutes for an independent baseline.

## Measurement order

The engine runs these attributable phases in order:

1. Create a versioned run record, calibrate browser-visible client capability, and collect three family-specific IPv4 and IPv6 HTTPS timings where reachable.
2. Load the versioned endpoint directory, probe compatible endpoints, and select one endpoint.
3. Collect browser Resource Timing and any explicitly exposed server TCP/QUIC telemetry, then warm the latency path and collect sequential idle HTTPS round trips.
4. In a Web Worker, discard a download warm-up and run the adaptive 1 → 2 → 4 → 6/8 capacity ramp while lightweight download-loaded latency probes continue.
5. In the same worker architecture, discard an upload warm-up and run the bounded upload ramp while lightweight upload-loaded latency probes continue.
6. Derive maximum capacity and the separately labeled reliable stable-window result from their real ramp stages.
7. Use a controlled WebSocket echo when the selected endpoint advertises one; otherwise attempt the separately labeled experimental WebRTC/STUN UDP-reachability check.
8. Calculate bufferbloat and stability, run a bounded secondary download when an independent backup endpoint exists, calculate confidence, and create the Accuracy Passport.
9. Publish a result only after a completed or explicitly low-confidence terminal state. Failed and cancelled runs are not published.

Download and upload are sequential. Running both directions together would measure full-duplex contention, but it would make loaded latency impossible to attribute to one direction. The validation lab can add independent background upload or download saturation when that is the condition under study.

## Throughput

### Download

The endpoint returns cache-busted, `no-store` application payload. A dedicated Web Worker reads `ReadableStream` chunks and counts bytes delivered to JavaScript. A discarded warm-up seeds adaptive request sizing but no longer suppresses later stream stages.

```text
stage capacity Mbps = total bytes from every stream × 8 ÷ one shared stage window in milliseconds ÷ 1,000
```

The stream ramp is 1 → 2 → 4 → 6 → 8 in the full profile. A higher stage runs only while aggregate throughput continues improving by at least 5%, subject to the duration and byte ceilings. Request payloads target a useful transfer interval and grow with measured per-stream capacity. In the five-stage Full profile, the per-stage shares are 3%, 4%, 18%, 10%, and 65%, preserving enough payload for an approximately four-second final stage near 1 Gbps. **Maximum Capacity** is the fastest stage that reaches the minimum comparison duration when one exists; otherwise the fastest real stage is retained with an explicit limited-confidence reason. **Reliable Throughput** is the median of the stable half of real 500 ms windows from the highest completed stage using at most four streams; single-stream throughput is also retained.

All timing uses `performance.now()`. Request diagnostics retain TTFB and transfer-only duration, but the capacity denominator deliberately covers the complete shared stage, including request turnover. Failed and aborted requests remain visible evidence and reduce confidence. A response that explicitly reports non-identity content encoding is rejected. Completed response payload is counted from the bytes actually read, not trusted from `Content-Length`.

In this document, a stream is a concurrent browser Fetch request, not proof of a separate TCP or QUIC connection. HTTP/2 and HTTP/3 can multiplex requests from the same origin onto fewer transport connections. The current single Cloudflare origin therefore cannot reproduce the independent-connection topology of a native client or a multi-host test network. NetPulse records this limitation rather than inventing connection counts.

### Upload

NetPulse creates one non-personal, in-memory random payload per upload stage in Web Crypto-sized chunks before the shared network timer starts, then reuses that incompressible body across the stage's requests. This prevents mobile CPU cost from being mislabeled as network transfer time. A request counts only after Fetch resolves with a successful HTTP response:

```text
upload Mbps = successfully submitted application payload bytes × 8 ÷ actual phase milliseconds ÷ 1,000
```

Fetch does not expose byte-level upload progress. Live upload observations therefore use cumulative successfully submitted payload over elapsed time. When a provider exposes an allowlisted received-byte receipt such as `cf-meta-upload-bytes`, NetPulse uses that received count and retains it in request diagnostics; it does not invent a receipt when the header is absent. Aborted partial bodies, HTTP/TLS/TCP/IP overhead, retransmissions, and link-layer overhead are excluded.

### Duration, streams, and data

The checked-in profiles are the source of truth:

| Profile | Download ramp | Upload ramp | Configured payload ceiling |
| --- | --- | --- | --- |
| Full | 1 → 2 → 4 → 6 → 8 streams, 15 s / 750 MB cap, 64 MB max request | 1 → 2 → 4 streams, 11 s / 150 MB cap, 8 MB max request | 902.512 MB including warm-ups, before bounded in-flight overshoot |
| Low data | 1 → 2 streams, 5 s / 25 MB cap | 1 stream, 3.5 s / 10 MB cap | 36.256 MB including warm-ups, before bounded in-flight overshoot |
| Quick diagnostics | 1 → 2 streams, 3.5 s / 14 MB cap | 1 stream, 2.5 s / 5 MB cap | 19.942 MB including warm-ups, before bounded in-flight overshoot |

Results record every ramp stage, shared-window capacity, reliable median/P5/P95/peak, request size, actual streams, exact application bytes, warm-up bytes, duration, failed requests/probes, stop reason, protocol when visible, cache/compression headers, and privacy-filtered per-request timing. The UI receives progress no more frequently than every 100 ms and uses that only as a presentation target.

## Latency and jitter

Latency uses a complete zero-byte HTTPS request to the selected endpoint, timed by monotonic `performance.now()`:

```text
RTT sample = response body drained timestamp − request start timestamp
idle latency = median(sequential idle RTT samples)
loaded latency = median(RTT samples started while the relevant load phase is active)
```

HTTPS RTT includes browser scheduling, connection reuse, HTTP, TLS where required, endpoint processing, and the network path. It normally exceeds raw ICMP RTT and is not interchangeable with ping.

Jitter is the mean absolute difference between consecutive RTT samples:

```text
jitter = Σ |RTT[i] − RTT[i−1]| ÷ (sample count − 1)
```

At least two successful samples are needed. NetPulse also retains minimum, mean, interquartile mean, median, P90, P95, P99, standard deviation, successful count, and failed count.

## Bufferbloat and stability

Bufferbloat is calculated separately and never inferred from throughput alone:

```text
download bufferbloat = max(0, median(download-loaded RTT) − median(idle RTT))
upload bufferbloat   = max(0, median(upload-loaded RTT) − median(idle RTT))
```

Grades are A below 30 ms, B below 60 ms, C below 100 ms, D below 200 ms, and F at 200 ms or above. Overall is the worse direction.

Stability starts at 100 and applies bounded penalties: loaded-latency standard deviation 30%, spike ratio 30%, worse throughput coefficient of variation 20%, failed probes/requests 15%, and incomplete test 5%. A spike exceeds `max(3 × idle median, idle median + 150 ms)`. This is a transparent product score, not a standardized network statistic.

## Packet loss

True packet loss is unavailable in production. WebRTC/STUN can observe whether UDP produced a server-reflexive or relay ICE candidate and how long gathering took. It cannot count sent and echoed packets, so NetPulse does not convert it into a loss percentage. A capability-gated WebSocket echo counts application messages, lateness, and observable reordering; its reliable TCP transport retransmits lost network packets, so NetPulse reports **message-delivery loss**, never packet loss.

The lab contains an iperf3/UDP-capable endpoint for calibration, but browsers cannot open raw UDP sockets. A public loss metric requires a reviewed, abuse-bounded cooperating browser protocol and independent packet-accounting validation.

## Confidence

Run confidence begins at 100 and applies visible deductions for insufficient samples, high variation, endpoint health/load, missing independent endpoint evidence, client-calibration limitations, failed warm-ups, short phases, a backgrounded tab, incomplete execution, and failed requests/probes. It is clamped to 0–100. The Accuracy Passport records these reasons with run ID, engine/methodology versions, streams, data, duration, sample counts, endpoint facts, and the honest status of any secondary check.

Confidence predicts trustworthiness; it is not proof of accuracy. The lab evaluates calibration with a Brier score:

```text
Brier = mean((confidence ÷ 100 − within-tolerance outcome)²)
```

The outcome is 1 only when a completed run's download, upload, and idle latency meet tier gates against an independent baseline. Confidence buckets must become monotonically more accurate before the score can be called calibrated.

## Server discovery and selection

The browser validates a versioned endpoint directory. Disabled entries are excluded. Candidates are checked for protocol compatibility, reachability, health, draining/unavailable state, and freshness. Ranking uses median HTTPS latency 35%, P95 tail latency 10%, HTTPS jitter 10%, observed probe consistency 15%, reported health 15%, reported load 10%, and reported capacity headroom 5%, multiplied by probe availability. Unknown telemetry receives a cautious neutral score, not a healthy score.

Selection keeps backups and discloses degraded mode. Geographic distance alone does not select a server, and an edge code is not presented as the user's city. The checked-in directory currently advertises one real Cloudflare anycast fallback. Proposed NetPulse-operated regions remain planned until independently validated infrastructure exists.

When a compatible backup exists, NetPulse runs a bounded one- or two-stream secondary download. Results within 25% are labeled agreement; larger differences are labeled disagreement. The primary result remains unchanged, the two endpoints are never averaged, and the secondary payload is included in data-use accounting. Without a backup, verification is unavailable.

## IPv4, IPv6, and transport telemetry

Preflight makes three cache-busted HTTPS requests to family-specific IPv4 and IPv6 hosts. Each family retains median, P95, jitter, successes, and failures. A preferred family is shown only when both paths succeed and their medians differ by more than `max(3 ms, 10% of the faster median)`. This comparison applies only to those HTTPS destinations and does not imply a universal route preference.

Transport telemetry uses browser Resource Timing for the negotiated application protocol and optional `X-NetPulse-*`/`Server-Timing` response headers from a cooperating endpoint. TCP RTT, QUIC RTT, and retransmit counts remain null unless the server explicitly reports bounded values. Throughput, browser RTT, or protocol names are never converted into invented kernel telemetry.

## Health score

The separate connection-health score weights download 24, upload 16, idle latency 12, bufferbloat 20, jitter 8, stability 8, and run confidence 12. Packet loss has zero weight while unavailable. The UI shows every rule, input, weight, and earned point. This describes likely experience; it is not validation confidence.

## Privacy

- Full public IP is masked before application state, export, or history storage.
- Complete privacy-filtered events and phase journals are retained in IndexedDB for at most the latest 20 local runs; compact normalized history remains in localStorage.
- Automatic trace data can provide a country code and serving edge; neither is street-level location.
- ISP, ASN, city, and region are not inferred from an edge code. Optional lookups are user initiated and approximate.
- Lab records reject direct IP, coordinates, exact location, street address, and email fields.
- The internal dashboard reads files locally and does not upload them.
- Lab result files are ignored by Git.

## Browser and device limitations

- Background tabs can throttle timers/networking; visibility is recorded and confidence reduced.
- Rendering consumes event batches at most every 100 ms; raw evidence is retained synchronously so chart/gauge work does not define measurement timing.
- Cancellation is propagated with `AbortSignal`; partial results are discarded and in-flight browser operations are closed where the API allows.
- Fetch cannot expose upload byte progress, TCP retransmissions, congestion-control state, or protocol overhead.
- Browsers do not provide portable per-tab CPU usage, Wi-Fi signal/SSID/channel, router details, or LAN device lists.
- Chromium exposes some heap/long-task telemetry that Firefox/WebKit may not; missing fields remain null with a reason.
- Playwright WebKit is not Safari; Chromium is not native Edge or Chrome. Native evidence is separate.
- Multi-gigabit results can be limited by CPU, memory copies, browser, NIC, switch, bridge, and endpoint. 2.5/5 Gbps requires hardware headroom certification.
- iOS, Android, battery saver, VPN, mobile radio, IPv6, Wi-Fi, and background behavior require real platform runs.

## Why competitors differ

NetPulse is not tuned to reproduce Ookla, FAST.com, Cloudflare, or M-Lab. Differences can come from endpoint route/capacity, anycast versus explicit regions, streams, warm-up/duration, payload, congestion control, application versus wire-byte accounting, browser limits, and aggregation. Comparative runs are diagnostic context; controlled iperf3 TCP/UDP and routed ping are the accuracy baseline. The UDP baseline retains observed loss rather than treating the configured `netem` percentage as ground truth.

## Validation tolerances

Each launch-gate segment needs at least ten retained attempts, including failures.

| Tier | Median absolute throughput error | P95 absolute throughput error | Throughput CoV | Median/P95 idle-latency absolute error | Failure rate |
| --- | ---: | ---: | ---: | ---: | ---: |
| ≤100 Mbps | ≤10% | ≤20% | ≤5% | ≤3 / ≤8 ms | ≤1% |
| >100 Mbps to 1 Gbps | ≤12% | ≤25% | ≤6% | ≤3 / ≤8 ms | ≤1% |
| >1 Gbps to 5 Gbps | ≤15% | ≤30% | ≤8% | ≤5 / ≤12 ms | ≤2% |

These are proposed engineering gates. They do not turn unrun segments into passes. Jitter and bufferbloat tolerances must be finalized against observed baseline distributions because a configured `netem` value is not itself measured RTT-jitter ground truth.
