# NetPulse Production Accuracy Hotfix — Review Report

Status: implemented and validated locally. This hotfix has not been committed,
pushed, or deployed.

## Defect and root cause

The previous implementation compared throughput values produced from different
evidence bases:

- Maximum capacity used aggregate bytes over one shared stage window, selected
  from duration-qualified capacity stages.
- Reliable throughput used the median of cumulative completion observations
  from a different set of stages.
- Single-stream throughput could be published from a short stage that was not
  eligible for the maximum-capacity pool.

Those values were not mathematically comparable. A reliable or single-stream
result could therefore exceed the published maximum without either underlying
request being fabricated.

## Corrected calculation

All three published throughput values now come from one receipt-consistent,
comparable stage pool:

```text
stage throughput (Mbps) =
  (accepted stage bytes × 8) / shared monotonic stage duration / 1,000,000

maximum capacity =
  maximum qualified aggregate stage throughput

reliable throughput =
  median aggregate throughput of comparable stages with up to four streams

single-stream throughput =
  aggregate throughput of a qualified one-stream stage
```

Duration-qualified stages are preferred. A short but otherwise valid run can be
published only as a quick estimate. Upload stages whose server receipt does not
match the request byte count, and completed download stages with an inconsistent
content length, are excluded. If comparable evidence is missing or remains
contradictory, the affected metric is inconclusive rather than reordered,
clamped, swapped, hidden, or shown as zero.

The Accuracy Passport records the selection basis, publication status, reasons,
engine version, methodology version, and endpoint limitations.

## Publication rules

- Confidence below 60% displays **Low-confidence estimate.**
- Insufficient duration, an incomplete ramp, or an exhausted data budget
  displays **Quick estimate.**
- Inconclusive throughput is displayed as **Measurement inconclusive**, not as
  a definitive number and not as zero.
- Results explicitly state **Not accuracy-certified.**
- Numeric history does not save a result when either headline throughput metric
  is inconclusive.

## Version and endpoint disclosure

- Engine: `4.0.2`
- Methodology: `2026.07.25-capacity-publication-v2`
- The UI and Accuracy Passport disclose that the test currently uses one
  Cloudflare anycast measurement origin.
- Independent endpoint verification is not yet available.
- Routing and endpoint conditions can influence results.

## Automated validation

Command:

```text
npm run check
```

Results:

- TypeScript: passed (`tsc --noEmit`)
- ESLint: passed with zero warnings
- Tests: 29 files passed, 160 tests passed
- Production build: passed with Vite 8.1.5
- Build advisory: the main JavaScript chunk remains above Vite's 500 kB
  advisory threshold; this is pre-existing performance work, not a correctness
  failure.

The added coverage includes:

- reliable throughput greater than maximum under the old mixed basis
- single-stream throughput greater than the qualified maximum
- low confidence
- incomplete duration
- exhausted data budget
- upload receipt mismatch
- unavailable metrics
- history serialization and rejection of unavailable numeric results

## Local browser verification

Preview: `http://127.0.0.1:5180/`

A real low-data smoke test completed with:

- Download: 287 Mbps maximum, 260 Mbps reliable, 232 Mbps single-stream
- Upload: 30.0 Mbps maximum, 30.0 Mbps reliable, 30.0 Mbps single-stream
- Confidence: 51%, correctly labeled **Low-confidence estimate.**
- Qualification: correctly labeled **Quick estimate.**
- Certification: correctly labeled **Not accuracy-certified.**
- IP address: masked in the interface
- Endpoint: one Cloudflare IAD anycast origin, with no independent backup

Additional checks:

- Desktop viewport: 1440 × 900, no horizontal overflow
- Mobile viewport: 390 × 844, no horizontal overflow
- History: the completed numeric result was present after navigation
- Browser console: no warnings or errors
- Final review tab: Speed Test route with Start Test available

This smoke run validates the publication workflow and browser behavior; it is
not a controlled accuracy certification.

## Remaining limitations

- NetPulse still relies on one Cloudflare anycast measurement origin.
- There is no independent endpoint capable of confirming an abnormal result.
- Routing, endpoint load, browser scheduling, device limits, and the selected
  test budget can affect measurements.
- Quick or low-confidence estimates should be rerun with the standard profile
  before making performance decisions.
- Controlled multi-browser and multi-speed-tier laboratory validation remains
  necessary before making public accuracy claims.
