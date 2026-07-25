# NetPulse accuracy certification plan

Status: proposed validation gate; no certification has been achieved

## 1. Claim boundary

NetPulse may describe its implementation and report local observations. It
must not claim certified global, gigabit, multi-gigabit, browser, platform, or
regional accuracy until the corresponding matrix below passes with retained
failures and independently reviewable evidence.

Competitor products are comparison context, not baselines. Controlled
receiver-side iperf3, node receipt accounting, routed latency probes, and
independently calibrated loss generators are the primary references.

## 2. Required environments

Controlled bandwidth tiers:

- 1, 5, 10, 25, 50, 100, and 500 Mbps;
- 1 and 2.5 Gbps;
- 5 Gbps only on hardware with verified end-to-end headroom.

Controlled RTT:

- 5, 20, 50, 100, 200, and 300 ms.

Impairments:

- symmetric/asymmetric rates;
- jitter distributions, not only one configured value;
- 0.1%, 0.5%, 1%, 2%, and 5% random loss;
- burst loss, reordering, and duplication;
- upload/download background saturation;
- shallow/deep queues and bufferbloat;
- intermittent outage and endpoint failure;
- path-quality change;
- server overload, drain, stale health, and version mismatch.

Each controlled condition requires at least 20 completed-or-failed attempts
for a release claim. Ten attempts may be used only as an engineering smoke
gate. Trial order is randomized and cooling/recovery periods are documented.

## 3. Browser/platform matrix

Native evidence is required for:

- Chrome, Edge, Firefox, and Safari;
- Windows, macOS, and Linux;
- Android Chrome and iOS Safari;
- desktop, laptop, low-power, and high-performance devices;
- Wi-Fi, Ethernet, mobile, and VPN;
- IPv4-only, IPv6-capable, and dual-stack;
- foreground, background, battery saver/Low Power Mode, and high CPU load.

Playwright Chromium is not native Edge; Playwright WebKit is not Safari.
Emulation is useful for regression, not platform certification.

## 4. Regional/node matrix

Every claimed region requires:

- clients on at least three external ISPs;
- one route from outside the node's cloud provider;
- IPv4 and IPv6 where claimed;
- nearby and distant client paths;
- primary and provider-diverse secondary node;
- concurrent-client load through admission control;
- controlled reference probe from a second cloud;
- failover, drain, health expiry, directory rollback, and node version tests.

Node capacity is certified separately from client accuracy. A node must sustain
the public maximum profile plus concurrent safety margin without depressing
reference results beyond tolerance.

## 5. Evidence per trial

Each record contains:

- random trial/run IDs and immutable configuration revision;
- engine, methodology, passport, node protocol, directory, and node versions;
- shaped rate/RTT/impairment configuration plus observed baseline;
- browser/device class, OS version, visibility/power state, and address family;
- endpoint/provider/region and health/capacity snapshot;
- all ramp stages, stable windows, request diagnostics, bytes, durations,
  failures, stop reasons, and loaded probes;
- upload server receipts and reconciliation;
- packet/delivery ledger when applicable;
- CPU/main-thread/frame/heap observations when exposed;
- confidence score/reasons and pass/fail outcome;
- privacy review result.

Failed, cancelled, and rejected records are retained with a reason. Direct IP,
exact location, credentials, and payloads are prohibited.

## 6. Statistical definitions

For baseline `B` and NetPulse result `N`:

```text
signed_error_pct = 100 * (N - B) / B
absolute_error_pct = 100 * abs(N - B) / B
latency_error_ms = N - B
failure_rate = failed_or_invalid_attempts / all_attempts
variation = sample_standard_deviation(completed_results) / mean(completed_results)
```

Report median, mean, P95 absolute error, signed-error distribution, bootstrap
95% interval, failure rate, variation, time to stable result, transferred
bytes, and resource impact. Do not hide under-measurement inside absolute error.

Confidence calibration:

```text
within_tolerance = 1 when all mandatory metric gates pass, otherwise 0
Brier = mean((confidence / 100 - within_tolerance)^2)
```

Also publish bucket reliability and expected calibration error. Confidence
must become monotonically more reliable across buckets.

## 7. Proposed launch tolerances

These are gates to review, not achieved results.

| Tier | Median throughput absolute error | P95 absolute error | CoV | Failure rate |
| --- | ---: | ---: | ---: | ---: |
| up to 100 Mbps | at most 10% | at most 20% | at most 5% | at most 1% |
| over 100 Mbps to 1 Gbps | at most 12% | at most 25% | at most 6% | at most 1% |
| over 1 Gbps to 5 Gbps | at most 15% | at most 30% | at most 8% | at most 2% |

Idle latency gates:

- up to 1 Gbps: median absolute error at most 3 ms and P95 at most 8 ms;
- multi-gig: median at most 5 ms and P95 at most 12 ms.

Loaded latency and jitter gates are defined after baseline protocol overhead is
measured. A configured netem value is not itself observed ground truth.

Upload receipt reconciliation:

- client completed bytes and server accepted bytes agree within
  `max(65,536 bytes, 0.5% of attempted bytes)` for every successful request;
- no partial/failed body is counted;
- server duration fields are monotonic and internally consistent;
- receipt/test/stage IDs match and receipt IDs are unique when the endpoint
  implements versioned identity;
- partial provider receipts remain disclosed and cannot establish
  server-timing authority.

Packet-loss certification:

- sent/received ledgers reconcile;
- median absolute error at least within 0.2 percentage points below 1% loss and
  within 15% relative error at 1% or higher;
- invalid or hidden retransmission conditions produce unavailable, not zero.

## 8. Required comparisons

On the same device and time block, collect:

- NetPulse Peak Capacity;
- NetPulse Reliable Throughput;
- iperf3 single-stream and multi-stream controlled baseline;
- M-Lab NDT7 single-flow result where data policy/terms are accepted;
- Ookla, FAST.com, and Cloudflare consumer results as external context.

For disagreements, classify:

- endpoint route/location and provider peering;
- endpoint capacity/load;
- stream or transport-connection topology;
- duration, warm-up, payload, and byte cap;
- application versus IP/wire byte definition;
- congestion control;
- browser/device/UI limitation;
- background traffic, Wi-Fi, VPN, or radio condition;
- aggregation and percentile.

Never tune formulas until the evidence identifies a mechanism.

## 9. Performance interference gate

For each tier, compare the same engine:

1. headless/minimal evidence consumer;
2. full dashboard with gauges/charts;
3. reduced-motion mode.

The median throughput difference between minimal and full UI should be below
2% through 1 Gbps and below 5% at multi-gig speeds, with no material failure
increase. Worker progress is capped at 10 Hz. Record long tasks, frame delay,
heap where available, worker errors, and browser process pressure.

## 10. Security and production gates

Before any public pilot:

- no mock/random/fallback measurement reaches production;
- secrets and private node URLs are absent from client artifacts;
- IP masking and export filtering pass;
- upload/session/rate/stream/byte limits pass adversarial tests;
- echo cannot relay, reflect, broadcast, or target arbitrary hosts;
- health/version/capacity spoofing is rejected;
- overload stops admission before result accuracy degrades;
- cancellation releases network and worker resources;
- dependency, SAST, secret, and production-build checks pass;
- retention and operational access are reviewed.

## 11. Certification artifacts

Produce:

- machine-readable trial records and schema revision;
- aggregate tables by speed, RTT, impairment, browser, device, family, region,
  endpoint, and version;
- failure inventory and root-cause disposition;
- confidence calibration plot/table;
- node capacity/overload report;
- resource-impact report;
- reproducible commands and lab topology;
- signed release decision with supported and unsupported claims.

The public accuracy page links the methodology, sample size, dates, hardware,
regions, versions, tolerances, failures, and raw privacy-safe aggregates.

## 12. Current status and next gate

The repository contains a controlled-lab design, 160 deterministic
stage-selection trials, and local source validation. Deterministic fixtures are
not production measurements. Docker/netem/iperf3 execution was blocked on this
host and no native iOS trial was available. Every certification segment is
therefore unmeasured.

Next gate: run a three-tier Chromium smoke matrix on a Docker-enabled,
headroom-verified host, then five affected-iPhone trials with exported
passports. Do not deploy a global node network or publish accuracy marketing
before those results are reviewed.
