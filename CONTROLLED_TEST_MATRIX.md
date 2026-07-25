# NetPulse controlled test matrix

Status: harness defined; Docker execution blocked on this Windows host because
the Docker engine is not running.

The real controlled lab is documented in [lab/README.md](lab/README.md). It
uses Linux traffic control, a local measurement node, iperf3, routed ping, and
Playwright. Deterministic fixtures validate formulas and semantic gates only;
they never populate production results and are not browser-accuracy evidence.

## Required throughput profiles

| Profile | Download | Suggested upload | Required deterministic trials | Required real browser trials |
| --- | ---: | ---: | ---: | ---: |
| 10 Mbps | 10 Mbps | 5 Mbps | 20 | 5 |
| 25 Mbps | 25 Mbps | 10 Mbps | 20 | 5 |
| 50 Mbps | 50 Mbps | 20 Mbps | 20 | 5 |
| 100 Mbps | 100 Mbps | 40 Mbps | 20 | 5 |
| 300 Mbps | 300 Mbps | 100 Mbps | 20 | 5 |
| 500 Mbps | 500 Mbps | 100 Mbps | 20 | 5 |
| 1 Gbps | 1,000 Mbps | 200 Mbps | 20 | 5 |
| 2.5 Gbps | 2,500 Mbps | 500 Mbps | 20 | 5, verified hardware only |

## RTT and impairment profiles

- RTT: 5, 20, 50, and 100 ms for Phase 2; the existing extended lab also
  supports 200 and 300 ms.
- Jitter and random packet loss.
- Asymmetric download/upload.
- Download saturation and upload saturation.
- Shallow/deep queues and directional bufferbloat.
- Endpoint interruption and intermittent outage.
- Browser cancellation.
- Foreground/background tab behavior.
- Controlled path-quality change. This is not labeled BGP route emulation.

## Trial evidence

Every trial retains:

- configured shaper condition and observed iperf3/ping baseline;
- engine, methodology, directory, endpoint, browser, and environment versions;
- publication outcome, maximum, reliable, and single-stream status;
- exact stage bytes, durations, windows, qualification, failures, and receipts;
- latency, jitter, directional bufferbloat, confidence, duration, and data use;
- long tasks, frame delay, heap where available, and unavailable reasons.

Failures, cancellations, quick estimates, low-confidence runs, and
inconclusive runs remain in the denominator.

## Repeated-trial calculations

For every tier:

```text
signed error % = 100 * (NetPulse - baseline) / baseline
absolute error % = 100 * abs(NetPulse - baseline) / baseline
failure rate = failed attempts / all attempts
inconclusive rate = inconclusive attempts / all attempts
CoV = sample standard deviation(completed results) / mean(completed results)
```

Report median result, mean absolute error, median absolute error, P95 absolute
error, CoV, failure rate, inconclusive rate, average duration, average data,
and confidence calibration.

## Current execution status

The deterministic semantic matrix executed 20 trials at all eight required
speed tiers. The Docker/tc/iperf3 matrix and five real browser trials per
condition did not execute because the local Docker daemon is unavailable.
Therefore no speed tier or browser is accuracy-certified.
