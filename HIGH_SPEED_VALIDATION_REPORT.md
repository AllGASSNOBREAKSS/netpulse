# High-speed measurement defect validation report

Date: 2026-07-25
Status: local engineering build only; not committed, pushed, merged, or deployed.

## Reported defect

On the same iPhone, Wi-Fi, and location:

- NetPulse: 325 Mbps download
- Speedtest.net: 1,042.69 Mbps download

The exact request-level cause of that historical 325 Mbps result is not
recoverable. The old result schema did not retain stream IDs, request timing,
TTFB, transfer duration, HTTP status, protocol, content encoding, or abort
reasons. It would be false precision to select one cause after the fact.

What is proven from the old source is that NetPulse could not certify gigabit
capacity: the full profile used a separate 1 MB warm-up, one single-stream
phase, and at most four multi-stream requests. Its adaptive request size
targeted 750 ms but was capped at 25 MB; at 1 Gbps, 25 MB is roughly 200 ms of
payload. Repeated request startup/TTFB and main-thread work could therefore
occupy a material share of the phase. A stable four-stream result did not prove
that a six- or eight-stream stage would not improve.

A later same-phone sequence recorded NetPulse 596 Mbps, Speedtest.net 755.02
Mbps, and FAST.com 900 Mbps. Production bundle inspection confirmed that run
still used engine 3.1.0 without the worker repair. NetPulse was 21.1% below
Speedtest.net and 33.8% below FAST.com. The two competitors also differed by
19.2%, consistent with their different endpoint routes and definitions.

## Defects corrected locally

1. Network streaming and throughput statistics now run in a module Web Worker.
2. UI events are throttled to 100 ms and remain presentation-only.
3. Download uses a real 1 → 2 → 4 → 6 → 8 full-profile ramp.
4. Upload uses a real 1 → 2 → 4 full-profile ramp.
5. A short warm-up sizes requests but cannot suppress later ramp stages.
6. Aggregate capacity uses all stage bytes over one shared monotonic stage
   window.
7. Ramp advancement depends on measured aggregate improvement. Byte-capped
   stages too short for a fair comparison do not prematurely terminate it.
8. Maximum Capacity, Reliable Throughput, and Single-stream Throughput are
   separate results.
9. Reliable Throughput is a stable-half median of real 500 ms windows. A run
   with fewer than two windows is labeled `limited`, not stable.
10. Every request retains privacy-filtered endpoint, stage concurrency, stream
    and request IDs, monotonic start/response/first-byte/end timestamps, TTFB,
    transfer duration, bytes, transfer rate, HTTP status, protocol when
    visible, cache/compression/content-length facts, provider upload receipt
    when exposed, and abort/failure reason.
11. Download and upload saturation remain sequential; lightweight loaded
    latency probes run during their respective direction.
12. Exports and methodology details expose maximum, reliable, single-stream,
    bytes, duration, stream count, endpoint evidence, and diagnostics.
13. The five-stage download budget now reserves 65% for the final stage instead
    of 35%. At approximately 900 Mbps this changes the final-stage allowance
    from about 2.33 seconds to about 4.33 seconds within the same 750 MB cap.
14. Sub-minimum ramp stages no longer outrank a duration-qualified stage for
    Maximum Capacity merely because a very short burst was faster.
15. Upload random-body generation now occurs once before each timed stage and
    is reused, preventing mobile CPU work from depressing network throughput.
16. Explicitly compressed measurement responses are rejected. Cloudflare's
    received-byte upload header is used when exposed.
17. Results now disclose that concurrent same-origin Fetch requests may be
    multiplexed and do not prove an equal number of TCP/QUIC connections.
18. Completed upload responses now create cumulative accepted-payload
    observations. The previous worker draft produced no upload observation
    series even when the POSTs succeeded.
19. A loaded-latency request cancelled by normal stage shutdown is no longer
    counted as a failed network probe.

## Formula comparison

### Before

```text
old headline Mbps =
  total application bytes in a fixed single/multi phase × 8
  ÷ complete phase milliseconds
  ÷ 1,000
```

The conversion was correct, but the fixed phase did not prove saturation.
Warm-up TTFB influenced concurrency and request size. Request TTFB and turnover
were not separable from transfer time.

### After

```text
stage capacity Mbps =
  total application bytes from all stage streams × 8
  ÷ one shared performance.now() stage window in milliseconds
  ÷ 1,000

maximum capacity = max(completed stage capacity)

reliable throughput =
  median(stable half of real 500 ms windows from the highest completed
         stage using at most four streams)
```

TTFB and transfer-only throughput are diagnostic evidence. Neither replaces the
shared-window capacity denominator.

## Full-profile configuration

| Direction | Warm-up | Ramp | Stage timing | Max request | Duration cap | Application-byte cap |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| Download | 2 MB | 1 → 2 → 4 → 6 → 8 | 2.2 s candidate stages; 4 s final target, bounded by cap | 64 MB | 15 s | 750 MB |
| Upload | 512 kB | 1 → 2 → 4 | 2.2 s candidate stages; 3.5 s final target, bounded by cap | 8 MB | 11 s | 150 MB |

The download endpoint payload is provider-generated binary. The live endpoint
reported `Cache-Control: no-store, no-transform`, exact `Content-Length`, and
no `Content-Encoding`; NetPulse cannot independently prove payload entropy.
Upload payloads are generated with Web Crypto and are incompressible in
practice.

Full-profile download stage budget shares are 3%, 4%, 18%, 10%, and 65%.
The final share is approximately 486.2 MB after the 2 MB warm-up, enough for
about 4.32 seconds at 900 Mbps or 3.89 seconds at 1 Gbps. The timer remains the
hard stop, so slower links do not consume the entire final byte allowance.

## Local browser observations

These observations use the same local Windows network and Cloudflare anycast
route. They are not a controlled bandwidth baseline and do not prove accuracy.

### Old engine, full profile

- displayed download: 269 Mbps
- displayed upload: 34.3 Mbps
- endpoint: Cloudflare anycast, EWR
- endpoint health/load/capacity: unavailable

### Diagnostic-only old engine, low-data profile

- displayed download: 251 Mbps
- displayed upload: 31.8 Mbps
- measured download requests: 6
- completed: 3
- stopped at phase condition: 3
- median request TTFB: 75.2 ms
- request payloads: about 7–8 MB
- response compression: not observed
- request protocol: unavailable through Resource Timing

This demonstrates request overhead and early byte/phase stops, but is not the
affected iPhone run.

### Worker engine, full profile

- Maximum Capacity download: 367.3 Mbps
- Reliable Throughput download: 333.9 Mbps
- Single-stream download: 343.8 Mbps
- download ramp stages completed: 3 (1, 2, then 4 streams)
- selected maximum stage: 2 streams
- reliable window P5/P95: 295.7 / 372.2 Mbps
- total download payload: 235.51 MB
- Maximum Capacity upload: 32.0 Mbps
- Reliable Throughput upload: 21.7 Mbps, limited sample status
- total run payload: 250.9 MB
- run duration: 11.6 s
- request diagnostics: 27
- browser console errors/warnings: none

The local maximum rose by about 36.5% from 269 to 367.3 Mbps. This is evidence
that the old engine was client/method limited on this route; it is not proof
that the new value equals an independent line-rate baseline.

### Worker engine, low-data profile

- Maximum Capacity download: 258.6 Mbps
- Single-stream download: 211.6 Mbps
- two ramp stages completed
- Reliable Throughput: 258.6 Mbps, correctly labeled limited because only one
  stable-window sample fit the data cap
- total download payload: 25.01 MB
- worker used: yes

### Worker engine 4.0.1, full profile after high-speed budget repair

Two additional uncontrolled desktop runs completed against Cloudflare IAD:

| Run | Maximum download | Reliable download | Single stream | Upload maximum | Data | Confidence |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A | 380 Mbps | 255 Mbps | 229 Mbps | 31.3 Mbps | 250.6 MB | 16% |
| B | 317 Mbps | 364 Mbps | 279 Mbps | 31.3 Mbps | 231.4 MB | 45% |

Run A exposed the missing upload-observation and intentional-probe-cancellation
bugs. After repair, Run B no longer reported either confidence deduction.
The result varied materially between consecutive runs and endpoint jitter was
high, so neither run is a controlled accuracy baseline. Reliable throughput
can exceed whole-stage Maximum Capacity when stable 500 ms windows exclude
slow-start/request-startup time that remains inside the shared stage window;
both values are retained rather than forced into an artificial ordering.

The browser reported engine `4.0.1-local`, methodology
`2026.07.25-high-speed-capacity-local`, a separate worker bundle, masked IP,
and no console warnings or errors. At an iPhone-sized 375 CSS-pixel content
viewport, both gauges were 336 pixels wide and the document had no horizontal
overflow. This responsive check is not an iOS network-accuracy trial.

## iOS-specific findings

No real iOS Safari trial was available in this checkout. The old engine merely
detected iOS; it had no worker isolation or saturation adaptation. The new
architecture removes React/chart/gauge scheduling from the measurement event
loop and records actual per-request WebKit behavior. It does not bypass WebKit
connection scheduling, memory limits, Low Power Mode, thermal throttling,
background-tab throttling, or absent Network Information API data.

Playwright WebKit is not accepted as Safari evidence. The affected iPhone must
rerun this local build and export its Accuracy Passport before the historical
325/596 Mbps discrepancies can be explained from recorded evidence. The
screenshots appear to be from Chrome on iOS; in the ordinary App Store model
Apple requires browser apps to use WebKit, with alternative-engine entitlements
limited by region and eligibility. Browser name alone therefore does not prove
Chromium networking behavior on this device.

## Required five-trial matrix

| Condition | Completed / required | Status |
| --- | ---: | --- |
| iOS Safari, affected Wi-Fi | 0 / 5 | blocked: physical device and original route unavailable |
| Android Chrome | 0 / 5 | blocked: physical device unavailable |
| Desktop Chromium, uncontrolled local route | 1 / 5 post-change | exploratory only; no controlled baseline |
| Controlled 100 Mbps | 0 / 5 | blocked: no active `tc`/netem or hardware shaper in this Windows session |
| Controlled 500 Mbps | 0 / 5 | blocked: same |
| Controlled 1 Gbps | 0 / 5 | blocked: same |
| Controlled multi-gigabit | 0 / 5 | blocked: certified endpoint, NIC, switch, and hardware shaper unavailable |

No medians, variation, failure rate, or competitor accuracy percentage is
reported for an unrun segment. Existing lab scaffolding remains the place to
record these trials against iperf3 and controlled shaping.

## Remaining limitations and launch status

- Only one active Cloudflare anycast provider endpoint exists. There is no real
  regional backup, server load/capacity/version report, or independent abnormal
  result verification.
- The browser cannot observe wire bytes, TCP congestion state, retransmissions,
  or upload progress.
- Resource Timing may withhold per-request protocol even with
  `Timing-Allow-Origin`.
- The full profile can use up to about 903 MB plus bounded in-flight overshoot;
  users must see the preflight budget before starting.
- A best result at eight streams reduces confidence because the ramp may still
  be client/profile limited.
- Native iOS, Android, controlled 100/500/1,000 Mbps, and multi-gigabit launch
  gates remain unrun.

Public-launch status for gigabit accuracy remains **not validated**. The local
implementation is suitable for native-device and controlled-lab review, not a
global accuracy claim.
