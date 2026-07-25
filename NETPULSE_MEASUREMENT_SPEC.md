# NetPulse browser measurement specification

Status: Phase 1 architecture draft
Normative terms: MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are used as
requirements for future NetPulse releases.

## 1. Product contract

NetPulse is a browser-first measurement system. It measures three different
questions and MUST keep them separate:

1. **Peak Capacity**: the highest duration-qualified aggregate application
   throughput reached by an adaptive saturation ramp.
2. **Reliable Throughput**: the sustained central tendency of stable windows
   using a realistic bounded request count.
3. **Internet Quality**: measured responsiveness, latency variation,
   directional loaded latency, bufferbloat, delivery evidence, and stability.

No single value is "the internet speed." Every published result MUST identify
the endpoint, route context available to the browser, method version, sample
evidence, data use, duration, and limitations.

## 2. Honesty invariants

- Production values MUST come from a direct observation or a documented
  calculation over direct observations.
- Unavailable data MUST be `null`/omitted and visibly labeled unavailable.
  It MUST NOT be converted to zero.
- A failed or cancelled run MUST NOT publish a completed headline result.
- A low-confidence completed result MAY be retained only when the reasons are
  visible and the raw evidence is sufficient to reproduce the calculation.
- Packet-loss percentage MUST remain unavailable without a validated
  unreliable echo protocol and reconciled sent/received sequence accounting.
- A WebSocket result MUST be called application-message delivery, not packet
  loss.
- Fetch request count MUST NOT be described as TCP or QUIC connection count.
- An anycast edge or IP-geolocation result MUST NOT be described as exact user
  or server location.
- Competitor results MUST NOT be used as ground truth or as a target to force
  NetPulse numbers upward.

## 3. Runtime boundaries

```text
React / presentation
  receives throttled typed progress
  interpolates gauges and charts with requestAnimationFrame
                |
                v
orchestrator / state machine
  owns run lifecycle, retry, cancellation, evidence and publication
                |
                v
measurement worker
  owns request scheduling, byte accounting, monotonic timing and statistics
                |
                v
selected measurement node
  download, upload receipt, latency, echo, health and version
```

React MUST NOT schedule network phases, calculate headline throughput, or
restart work because a component renders. Worker progress SHOULD be sent at no
more than 10 Hz. Raw evidence MUST be recorded independently of UI cadence.

## 4. Run state machine

The normative state sequence is:

```text
created
  -> preflight
  -> discovery
  -> probing
  -> selection
  -> idle-latency
  -> download-warmup
  -> download-capacity + download-loaded-latency
  -> upload-warmup
  -> upload-capacity + upload-loaded-latency
  -> optional-secondary-verification
  -> optional-delivery-test
  -> calculation
  -> completed | low-confidence | failed | cancelled
```

Download and upload saturation MUST be sequential. A separate full-duplex
experiment MAY run only as an explicitly labeled diagnostic and MUST NOT
replace either directional result.

Each phase record MUST contain:

- phase ID and attempt;
- wall-clock start/end for user interpretation;
- monotonic offset and duration for calculation;
- status and sanitized failure;
- sample start/end indexes;
- endpoint and method version;
- retry/cancellation reason.

## 5. Typed event contract

The internal event envelope is versioned:

```ts
type MeasurementEvent<T> = {
  schemaVersion: 1;
  runId: string;
  sequence: number;
  monotonicOffsetMs: number;
  phase: string;
  kind: string;
  payload: T;
};
```

Required event families:

- lifecycle: created, phase-started, phase-completed, retried, failed,
  cancelled, completed;
- discovery: directory-loaded, candidate-probed, endpoint-selected,
  endpoint-failed-over;
- throughput: stage-started, request-diagnostic, sample, progress,
  stage-completed;
- latency: sample, failure, summary;
- evidence: visibility-change, client-warning, transport-observation,
  confidence-updated.

Sequences MUST be monotonic per run. Consumers MUST ignore unknown future event
kinds rather than reinterpret them.

## 6. Throughput specification

### 6.1 Download

The worker MUST count bytes actually yielded by the response body. It MUST
reject non-success HTTP responses and declared non-identity content encoding.
Requests MUST use `no-store` plus a non-identifying cache-busting value.

For stage `s`:

```text
capacity_s_Mbps =
  8 * sum(application_bytes_received_in_s)
  / shared_stage_duration_seconds
  / 1,000,000
```

Equivalently for milliseconds:

```text
capacity_s_Mbps = bytes * 8 / duration_ms / 1000
```

The denominator starts immediately before stage requests are scheduled and
ends after stage completion/stop. It includes request setup, TTFB, turnover,
browser scheduling, and transfer. Transfer-only request throughput is
diagnostic evidence and MUST NOT replace the shared-window denominator.

Peak Capacity is the maximum aggregate rate among stages that meet the
profile's minimum comparison duration. If no stage qualifies, the fastest real
stage MAY be retained as limited evidence but MUST NOT be labeled validated
capacity.

Reliable Throughput is the median of a documented stable portion of 500 ms
aggregate byte windows from a completed stage with no more than four active
requests. The result MUST include P5, median, P95, peak, CoV, sample count,
stage duration, request count, and bytes. Fewer than two retained windows MUST
produce `limited`, not `measured`.

### 6.2 Upload

Upload payloads MUST be non-personal and effectively incompressible. Generation
and allocation SHOULD occur before the timed stage. Payload bodies MUST never
contain user data or be persisted by a NetPulse node.

An authoritative NetPulse upload result requires a server receipt:

```text
accepted upload Mbps =
  8 * server_accepted_application_bytes
  / server_receive_window_seconds
  / 1,000,000
```

Until that protocol exists, the browser MAY report successfully submitted
application throughput when an HTTP success or documented provider receipt is
observed, but MUST disclose that Fetch exposes no byte-level upload progress
and that server timing is not authoritative.

Aborted partial requests MUST NOT be counted as complete payload. HTTP, TLS,
TCP/QUIC, IP, retransmission, and link-layer bytes are outside application-byte
throughput.

### 6.3 Adaptive profile

The ramp MUST begin conservatively and MAY advance
`1 -> 2 -> 4 -> 6 -> 8` while measured aggregate throughput improves and
device, endpoint, duration, and byte budgets permit. A same-origin browser
request is a logical measurement stream only.

Adaptation inputs MAY include:

- warm-up throughput and duration;
- idle median and tail latency;
- request TTFB versus transfer time;
- worker/event-loop warnings;
- endpoint capacity/load telemetry;
- low-data preference and configured budget;
- connection/background state.

Adaptation MUST NOT use an unverified Network Information API estimate as
ground truth. A stage too short for comparison MUST NOT terminate the ramp
solely because its burst rate failed to improve.

## 7. Latency and variation

An HTTPS latency sample is:

```text
RTT = monotonic(body-drained timestamp - request-start timestamp)
```

Idle probes run sequentially before saturation. Loaded probes are lightweight,
use the same selected node, and are classified only when their request overlaps
the relevant load phase.

Published summaries retain successful count, failed count, minimum,
interquartile mean, mean, median, P90, P95, P99, standard deviation, and:

```text
jitter =
  sum(abs(RTT[i] - RTT[i-1]))
  / (successful_sample_count - 1)
```

At least two successful ordered samples are required for jitter. HTTPS latency
MUST be labeled application RTT and MUST NOT be called ICMP ping.

## 8. Bufferbloat and stability

Directional bufferbloat is:

```text
download rise = max(0, median(download-loaded RTT) - median(idle RTT))
upload rise   = max(0, median(upload-loaded RTT) - median(idle RTT))
```

NetPulse grades are product policy:

- A: less than 30 ms;
- B: 30 to less than 60 ms;
- C: 60 to less than 100 ms;
- D: 100 to less than 200 ms;
- F: 200 ms or more.

The stability score is a transparent derived product score, not uptime or an
industry standard. Its exact versioned weights and every input MUST be exposed.

## 9. Delivery and packet loss

Production packet loss remains unavailable until a controlled unreliable
transport can:

- send monotonically sequenced probes;
- prevent caching/replay and cross-session mixing;
- report sent, received, duplicate, reordered, and late counts;
- reconcile browser and server evidence;
- bound rate, amplification, reflection, duration, and payload;
- pass NAT, IPv4, IPv6, browser, mobile, and controlled-loss validation.

WebRTC ICE gathering MAY report UDP reachability. A controlled WebSocket echo
MAY report application-message delivery. Neither may populate
`packetLossPct`.

## 10. Endpoint selection and verification

Selection follows `SERVER_DISCOVERY_SPEC.md`. Geography is explanatory
metadata, not the sole selector. A primary endpoint requires compatible
protocol, successful probes, and acceptable health. Backup endpoints MUST be
retained when available.

A secondary capacity measurement:

- uses a separately validated and preferably provider-diverse endpoint;
- has its own byte/duration evidence;
- never replaces or averages the primary result silently;
- produces agreement, disagreement, or unavailable;
- reduces confidence on material disagreement.

Multi-server truth mode SHOULD report the set and dispersion. It MUST NOT hide
route-specific differences behind a blind mean.

## 11. Confidence and publication

Confidence estimates whether this run is trustworthy, not whether the
connection is good. Factors MUST be observable and versioned. Current
deductions include sampling, variation, warm-up/duration, failures, visibility,
endpoint health/load, backup availability, secondary agreement, and client
warnings.

Confidence MUST be calibrated against controlled pass/fail outcomes before
being marketed as a probability. Calibration is assessed with reliability
curves and:

```text
Brier = mean((confidence / 100 - within_tolerance)^2)
```

Publication gates:

- `completed`: all mandatory phases succeeded and evidence is internally
  consistent;
- `low-confidence`: mandatory phases succeeded but visible trust factors fall
  below the release threshold;
- `failed`: a mandatory phase failed or byte/timing evidence is inconsistent;
- `cancelled`: the user or lifecycle cancelled the run.

Only the first two may enter completed history, and their status MUST remain
attached.

## 12. Accuracy Passport

Every completed result MUST include the versioned object described in
`ACCURACY_PASSPORT_SCHEMA.md`. The passport is evidence, not certification.
It MUST exclude full IP, exact coordinates, upload contents, cache-busting
identifiers, credentials, and private infrastructure URLs.

## 13. Browser limitations

The browser cannot reliably expose:

- access-link rate or physical-layer overhead;
- Wi-Fi signal, channel, interference, router state, modem state, or LAN
  devices;
- TCP/QUIC congestion state or retransmissions without cooperating server
  telemetry;
- raw ICMP/UDP sockets;
- upload progress in Fetch;
- stable background timing;
- exact route/BGP state;
- exact physical location.

These limitations are result metadata, not errors to fill with estimates.

## 14. Version and change control

Changes to formulas, phase order, endpoint protocol, sample eligibility,
thresholds, confidence, or evidence schema require:

1. a new methodology or schema version;
2. unit and integration tests;
3. controlled regression evidence;
4. updated methodology and accuracy documentation;
5. release review confirming no old history is silently reinterpreted.

The current local engine identifies itself as `4.0.1-local` with methodology
`2026.07.25-high-speed-capacity-local`. These identifiers MUST change before a
reviewed production release.
