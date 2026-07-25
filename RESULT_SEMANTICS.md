# NetPulse result semantics

Status: Phase 2 local implementation
Engine: `4.1.0`
Methodology: `2026.07.25-phase2-semantics-v1`

This document defines what NetPulse may publish. It is normative for the
current local build and does not certify accuracy.

## Stage evidence

Every capacity candidate retains:

- a run-scoped stage ID and request concurrency;
- exact application bytes and shared monotonic duration;
- fixed-window samples, valid-window count, P5, P50, P95, peak, interquartile
  mean, and coefficient of variation;
- request payload size, failures, loaded-probe failures, and abort reasons;
- ramp state (`baseline`, `ramping`, `saturation`, or `ceiling`);
- endpoint health and stop reason;
- cache, compression, content-length, and upload-receipt evidence;
- a qualification status and all rejection/limitation reasons.

For each fixed window:

```text
window Mbps = application bytes completed in window * 8
              / window duration milliseconds
              / 1,000
```

The exact shared-stage aggregate remains evidence:

```text
aggregate stage Mbps = all accepted stage bytes * 8
                       / shared stage duration milliseconds
                       / 1,000
```

## Qualification

A definitive stage must satisfy all of the following:

1. positive finite bytes, duration, and throughput;
2. profile minimum duration and application bytes;
3. profile minimum valid sample count;
4. coefficient of variation no greater than the profile limit;
5. healthy endpoint evidence;
6. at least one completed transfer and no transfer failure;
7. no declared compression or completed download length mismatch;
8. no-store/no-cache response evidence;
9. receipt-consistent upload accounting.

A recoverable short, variable, data-capped, partially identified, or
health-limited stage is `estimate-only`. Invalid byte accounting, receipt
identity mismatch, duplicate receipts, compression, failed completion, or
non-positive evidence rejects the stage.

## Maximum capacity

Maximum capacity is the highest P50 fixed-window throughput among qualified
saturation-ramp stages:

```text
maximum capacity = max(P50 qualified stage windows)
```

Selecting P50 prevents one isolated burst from becoming the headline. The
chosen stage must still pass duration, bytes, samples, variation, endpoint,
completion, cache, compression, and receipt rules.

If no fully qualified stage exists but valid estimate-only evidence exists, the
result is a quick estimate. If only rejected evidence exists, maximum capacity
is inconclusive.

## Reliable throughput

Reliable throughput is a conservative sustained estimate from the best
qualified stage using no more than four concurrent browser requests:

```text
reliable throughput = P25(stable windows of selected qualified stage)
```

It is not the fastest window and is not calculated from cumulative upload
completion values. Fewer than the required samples, an incomplete ramp, or an
estimate-only stage produces a quick estimate. Rejected evidence produces an
inconclusive result.

## Single-stream throughput

The one-request ramp stage is a dedicated single-stream browser-request phase:

```text
single-stream throughput = P50(qualified one-request stage windows)
```

“Stream” means a Fetch request, not a guaranteed TCP or QUIC connection. If the
one-request phase is short, invalid, unhealthy, or receipt-inconsistent, the
single-stream metric is quick or inconclusive.

## Semantic invariants

Because maximum capacity is the maximum P50 across the same qualified pool:

```text
maximum capacity >= single-stream throughput
```

Because reliable throughput is P25 of a stage whose P50 participates in the
maximum pool:

```text
maximum capacity >= reliable throughput
```

NetPulse does not clamp, reorder, swap, or conceal values to enforce these
relationships. If the relationship still fails after qualified-window
recalculation, the affected metric is inconclusive, confidence is reduced, and
the reason is stored in the Accuracy Passport.

## Upload receipts

For every completed upload request NetPulse retains:

- client-attempted bytes;
- server-received bytes when exposed;
- browser duration and optional server receive duration;
- receipt version, receipt ID, test ID, stage ID, and completeness when
  exposed;
- byte disagreement and percentage;
- receipt validation status and reasons.

The allowed byte-accounting tolerance is:

```text
max(65,536 bytes, 0.5% of attempted application bytes)
```

Evidence outside this tolerance is rejected. Reused receipt IDs, mismatched
test/stage IDs, or an explicitly incomplete receipt are rejected. The current
Cloudflare origin exposes byte receipt evidence but not the complete NetPulse
receipt identity protocol, so identity is recorded as partial rather than
invented.

## Publication outcomes

Possible outcomes are:

- `complete`
- `complete-with-limitations`
- `quick-estimate`
- `low-confidence`
- `inconclusive`
- `incomplete`
- `failed`

Confidence below 60% displays **Low-confidence estimate.** Insufficient
duration, data, samples, ramp completion, or endpoint qualification displays
**Quick estimate.** Inconclusive values are `null`, never zero, and do not
enter numeric history or throughput score weighting.

Low-data mode has a 65% confidence ceiling; quick mode has a 55% ceiling.
Neither mode can be described as full gigabit-capacity certification.
