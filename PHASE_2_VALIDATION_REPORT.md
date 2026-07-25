# NetPulse Phase 2 validation report

Date: 2026-07-25
Status: local, uncommitted, not deployed
Engine: `4.1.0`
Methodology: `2026.07.25-phase2-semantics-v1`

## Executive result

Phase 2 resolves the known result-semantic inversion in code and adds
qualification, receipt, confidence, honesty-gate, and deterministic repeated
validation coverage. It does **not** establish public browser accuracy.

The real Docker/tc/iperf3 matrix could not run because this host has no running
Docker engine. No regional node deployment was started.

## Exact inversion cause

The prior implementation compared incompatible populations:

- maximum upload used accepted bytes over a shared stage window;
- reliable upload used the median of cumulative successful completion
  observations from another stage basis;
- single-stream could come from a stage excluded from maximum qualification.

The cumulative upload statistic could rise above the shared-window maximum
even when all bytes were real. Phase 1 aligned stage aggregates. Phase 2
finishes the correction by defining maximum as qualified-window P50, reliable
as qualified-window P25, and single-stream as one-request-stage P50.

## Stage qualification

A definitive stage now requires:

- minimum duration, bytes, and valid samples;
- acceptable coefficient of variation;
- healthy endpoint evidence;
- completed transfers without request failures;
- no response compression or download length mismatch;
- no-store/no-cache evidence;
- receipt-consistent upload accounting.

Every candidate records P5/P50/P95, interquartile mean, coefficient of
variation, valid sample count, ramp state, endpoint health, failures, stop
reason, qualification, and reasons.

## Low-data behavior

Low-data mode now has:

- a 39 MB application-payload hard ceiling including capacity warm-ups;
- a reduced `1 -> 2` download ramp and one-request upload phase;
- 600 ms intermediate and 1,200 ms final download targets;
- calibration-based request sizing and a 25%/75% ramp budget split;
- early statistical stopping after minimum evidence;
- a 65% confidence ceiling.

At 1 Gbps the entire 30 MB download budget represents about 240 ms of payload,
so it cannot satisfy the 1,200 ms final-stage target. That outcome is a quick
estimate, never definitive capacity, and recommends the full profile.

## Full/high-speed profile

| Direction | Warm-up | Ramp | Stage target | Final stable target | Hard payload ceiling | Max duration |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| Download | 4 MB | 1 → 2 → 4 → 6 → 8 | 2.0 s | 5.0 s | 2.5 GB | 18 s |
| Upload | 1 MB | 1 → 2 → 4 | 2.2 s | 4.0 s | 500 MB | 14 s |
| Low-data download | 0.75 MB | 1 → 2 | 1.2 s | 1.2 s | 30 MB | 6 s |
| Low-data upload | 0.128 MB | 1 | 1.0 s | 0.9 s | 8 MB | 4 s |

The full download ceiling reserves approximately 1.62 GB for the final stage,
enough for five seconds near 2.5 Gbps. These are safety ceilings, not typical
data promises. Duration/statistical validity and the hard data ceiling are
both enforced; conflict produces quick or incomplete evidence.

## Upload receipt validation

Diagnostics now retain attempted bytes, received bytes, browser duration,
optional server duration, receipt version/ID, test ID, stage ID, completeness,
disagreement bytes/percent, and status.

Allowed accounting tolerance:

```text
max(65,536 bytes, 0.5% of attempted bytes)
```

Mismatch, duplicate receipt IDs, wrong test/stage ID, or explicit incomplete
receipts reject the stage. Cloudflare's byte-only receipt remains partial
identity evidence and is disclosed; missing fields are not fabricated.

## Deterministic repeated trials

The test-only semantic harness ran 20 trials at each tier, 160 total. It
injects deterministic variation into qualified window evidence and exercises
the real stage-selection implementation. It does not emulate network I/O.

| Tier | Median result | Mean abs. error | Median abs. error | P95 error | CoV | Failure / inconclusive |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 10 Mbps | 10.025 | 1.6691% | 1.3534% | 3.7850% | 2.0693% | 0% / 0% |
| 25 Mbps | 25.0625 | 1.6691% | 1.3534% | 3.7850% | 2.0693% | 0% / 0% |
| 50 Mbps | 50.125 | 1.6691% | 1.3534% | 3.7850% | 2.0693% | 0% / 0% |
| 100 Mbps | 100.25 | 1.6691% | 1.3534% | 3.7850% | 2.0693% | 0% / 0% |
| 300 Mbps | 300.75 | 1.6691% | 1.3534% | 3.7850% | 2.0693% | 0% / 0% |
| 500 Mbps | 501.25 | 1.6691% | 1.3534% | 3.7850% | 2.0693% | 0% / 0% |
| 1 Gbps | 1,002.5 | 1.6691% | 1.3534% | 3.7850% | 2.0693% | 0% / 0% |
| 2.5 Gbps | 2,506.25 | 1.6691% | 1.3534% | 3.7850% | 2.0693% | 0% / 0% |

The identical relative error by tier is expected because these are
deterministic formula fixtures. It proves scale-invariant selection arithmetic,
not real-world accuracy. Median fixture confidence was 92; separate tests
verify that short duration, high variation, low-data mode, endpoint
degradation, receipt mismatch, semantic inconsistency, retries, and
backgrounding reduce confidence.

## Controlled execution blocked

Observed local Docker check:

```text
failed to connect to npipe:////./pipe/docker_engine
```

Therefore the following remain unexecuted:

- tc/netem bandwidth, RTT, jitter, loss, saturation, and interruption matrix;
- iperf3/ping baselines;
- five real Chromium/Firefox/WebKit trials per controlled condition;
- native Safari/iOS, Android, Edge, Wi-Fi, VPN, IPv6, low-power, and
  background-policy validation.

## Remaining limitations and Phase 3 recommendation

- One Cloudflare anycast measurement origin remains active.
- Independent endpoint verification is unavailable.
- Cloudflare does not expose the complete versioned NetPulse receipt identity
  protocol or authoritative server receive duration.
- Fetch cannot expose upload progress, transport retransmissions, or physical
  link capacity.
- Confidence has improved sensitivity tests but is not calibrated as a
  probability until controlled outcomes exist.

Phase 3 should begin by running the existing lab on a Docker-enabled,
headroom-verified host. Review three-tier Chromium smoke evidence first, then
the eight-tier/RTT/impairment matrix. Do not deploy regional nodes or publish
accuracy claims until those results pass the defined gates.
