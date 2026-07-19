# NetPulse validation

Automated tests cover the **pure measurement logic** — the code that turns
samples into results, grades, scores, and confidence. Network-dependent and
environmental scenarios are validated manually because they can't be reproduced
deterministically in CI without fabricating measurements (which the production
app never does).

## Running the automated suite

```bash
npm run check     # typecheck + zero-warning lint + tests + production build
npm test          # vitest run — 34 tests across 7 files
npm run test:watch
```

Test files live in `src/lib/__tests__/`:

| File | Covers |
|------|--------|
| `stats.test.ts` | median, percentile (P95/P99), mean, stddev, jitter, summarize |
| `grading.test.ts` | bufferbloat A–F boundaries, separate down/up grades, stability steady-vs-spiky, worse-direction throughput variation |
| `scoring.test.ts` | weight sum = 100, fast/slow/high-latency/bufferbloat cases, per-component caps |
| `confidence.test.ts` | foreground vs background, complete vs interrupted, separate sampling factors, exact deductions, errors/server |
| `servers.test.ts` | ranking by latency+jitter/reachability, intermittent and unavailable candidates, IPv4/IPv6 carried through |
| `throughput.test.ts` | fast byte-capped phases, measured-byte callbacks, endpoint failures, upload byte/time result |
| `networkIdentity.test.ts` | opt-in response validation, ASN normalization, IP masking, malformed-response rejection |

## Scenario matrix

Each required scenario, and how it is validated. **Fixtures are used only in
these tests and never in the production UI.**

| Scenario | How it's validated |
|----------|--------------------|
| Fast connection | `scoring.test.ts` (high throughput → high score); `throughput.test.ts` fast byte-capped phases |
| Slow connection | `scoring.test.ts` (low throughput → low score) |
| High latency | `scoring.test.ts` (idle latency drags score); idle-latency bands in `metrics.ts` |
| High jitter | `grading.test.ts` stability spiky case; jitter in `stats.test.ts` |
| UDP reachability | `packetloss.ts` returns an experimental UDP signal; verified manually (UDP OK / blocked / unknown). No packet-loss percentage is produced |
| Throttled bandwidth | `grading.test.ts` bufferbloat D/F; early-stop + caps in `throughput.ts` |
| Wi-Fi vs Ethernet | Manual — run on each; compare idle latency, jitter, bufferbloat |
| Foreground vs background tab | `confidence.test.ts` (background penalized); engine tracks `visibilitychange` |
| VPN enabled | Manual — preflight heuristic reports "possible" when timezone ≠ IP country or WARP on |
| Mobile connection | Manual — `preflight.ts` device-class detection; verified at 375 px viewport |
| Failed test server | `servers.test.ts` (unavailable → rank 0, not chosen) |
| Fast byte-capped phase | `throughput.test.ts` (final partial window remains non-zero and retains its overlapping loaded-latency probe) |
| Throughput HTTP error | `throughput.test.ts` (non-2xx endpoint responses cannot become a 0 Mbps result) |
| Interrupted test | `confidence.test.ts` (completed=false → sharp drop); engine try/finally cleanup |
| IPv4 and IPv6 | `servers.test.ts` (family carried through); `preflight.ts` best-effort family probes |

## Historical manual validation (before the current aggregation correction)

The following 2026-07-19 low-data run verified the pipeline and UI before the
current byte/time throughput correction. It is retained as historical evidence,
not claimed as validation of the new aggregation formula:

- Pipeline progressed through every phase: server → idle → download single →
  download multi → upload → UDP check → complete.
- Results: download single 185 / multi 271 Mbps, upload 32 (the former UI also showed an unsupported peak), idle 44 ms
  (p95 51, min 36), download-loaded 134 ms (+90), upload-loaded 112 ms (+68),
  jitter 6.7 ms, bufferbloat C (down C / up C), stability 25/100 (2 spikes),
  UDP reachability OK (STUN 41 ms), duration 6.1 s, data 42 MB.
- Confidence 60% (moderate) — correctly flagged the low download-sample count
  from the short low-data run and the backgrounded tab. This is the confidence
  system working, not a defect.
- Methodology modal: config, 6 server candidates, per-run limitations,
  methodology text, and JSON export (copy + download) all present.
- Responsive: no horizontal scroll at 375 px; preflight collapses to one column.
- Zero console errors.

## Known gaps

- No end-to-end packet-loss server (loss is experimental UDP reachability only).
- One production server provider (Cloudflare anycast) is registered; the
  selection code is multi-server but there is currently one candidate.
- A fresh deployed full/low-data live run is required for the corrected
  payload-over-phase-time throughput formula and opt-in identity UI.
- Environmental scenarios (VPN, mobile, Wi-Fi/Ethernet) rely on manual runs;
  they cannot be faithfully automated without synthetic network conditions.

## Current runtime validation (corrected aggregation)

A low-data production build was exercised through the local browser on
2026-07-19 after the payload-over-phase-time correction:

- All stages completed: preflight, server selection, idle latency, single and
  multi download, upload, UDP reachability, calculations, and result rendering.
- 254 Mbps multi-download, 27.4 Mbps upload from 8 accepted-payload
  observations, 54 ms idle, 80 ms download-loaded, 162 ms upload-loaded,
  6.5 ms jitter, bufferbloat D, stability 77/100, and 42 MB counted payload.
- Confidence was 84%; the UI exposed the exact 16-point deduction caused by
  only three download windows in the short byte-capped run.
- The health-score breakdown used the displayed 77/100 stability input and all
  six earned-point values summed to the displayed 67/100 result.
- Public IP was masked by default, opt-in ISP metadata was not requested, and
  the browser console contained no warnings or errors.
