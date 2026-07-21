# NetPulse validation

Automated tests cover the **pure measurement logic** — the code that turns
samples into results, grades, scores, and confidence. Network-dependent and
environmental scenarios are validated manually because they can't be reproduced
deterministically in CI without fabricating measurements (which the production
app never does).

## Running the automated suite

```bash
npm run check     # typecheck + zero-warning lint + tests + production build
npm test          # vitest run — 104 tests across 18 files
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
| `engine.integration.test.ts` | complete low-data orchestration, phase order, provider-response assembly, privacy masking, loaded latency, upload visibility, and confidence factors |
| `diagnostics.test.ts` | deterministic cause rules, evidence gates, confidence caps, unavailable diagnoses, prioritization, and privacy-safe report output |
| `diagnosticSessions.test.ts` | local-storage validation, corrupt/future schema rejection, replacement, deletion, and session cap |
| `blackbox.test.ts` | monitor modes, latency statistics, quality/confidence, incident thresholds/grouping, lag correlation, limitations, and bounded-analysis performance |
| `blackboxProbe.test.ts` | controlled DNS success/failure, trace privacy, and endpoint-family observations |
| `blackboxScheduler.test.ts` | monotonic cadence, delayed-tick skipping, and abort cleanup |
| `blackboxSessions.test.ts` | bounded retention, malformed/future schema rejection, refresh recovery, deletion, and quota failure reporting |
| `areaPulse.test.ts` | public aggregation thresholds, confidence labels, privacy-safe presentation, and incident expiry |
| `areaPulseSecurity.test.ts` | trusted-header parsing, HMAC separation, signed-request validation, strict report/abuse input, and safe response headers |
| `planReality.test.ts` | eligible-history filtering, median plan comparison, peak/off-peak and medium coverage, loaded-latency rise, reliability score, and neutral report output |
| `speedometer.test.ts` | fixed speed-band boundaries, piecewise dial mapping, and clamping for invalid or negative inputs |

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
| VPN enabled | Manual — Cloudflare WARP can be reported explicitly; other VPN/proxy status remains unknown because timezone/IP comparisons produce unacceptable travel and registration false positives |
| Mobile connection | Manual — `preflight.ts` device-class detection; verified at 375 px viewport |
| Failed test server | `servers.test.ts` (unavailable → rank 0, not chosen) |
| Fast byte-capped phase | `throughput.test.ts` (final partial window remains non-zero and retains its overlapping loaded-latency probe) |
| Throughput HTTP error | `throughput.test.ts` (non-2xx endpoint responses cannot become a 0 Mbps result) |
| Stable speedometer mapping | `speedometer.test.ts` verifies the fixed 0–100 blue, 100–200 yellow, 200–500 orange, and 500+ red bands without dynamic scale jumps |
| Interrupted test | `confidence.test.ts` (completed=false → sharp drop); engine try/finally cleanup |
| IPv4 and IPv6 | `servers.test.ts` (family carried through); `preflight.ts` best-effort family probes |
| Guided Wi-Fi/Ethernet comparison | `diagnostics.test.ts` requires a confirmed Wi-Fi baseline plus material near-router/Ethernet improvement |
| VPN on/off comparison | `diagnostics.test.ts` requires an explicit confirmed on/off pair; automatic VPN inference is not used |
| Background traffic comparison | `diagnostics.test.ts` requires a normal-versus-paused compatible pair |
| Other device comparison | `diagnostics.test.ts` requires a primary/other-device pair with material improvement |
| Peak/off-peak comparison | `diagnostics.test.ts` requires matched runs and caps confidence pending repetition |
| Router/modem restart | `diagnostics.test.ts` treats improvement as capped evidence and never proof of hardware failure |
| DNS, true packet loss, outage scope | `diagnostics.test.ts` verifies all remain unavailable with zero confidence |
| Black Box stable/degraded/interrupted time | `blackbox.test.ts` derives states only from real probe status, thresholds, and scheduling delay |
| Black Box latency spikes and severe jitter | `blackbox.test.ts` verifies published adaptive thresholds and contiguous grouping |
| User lag marker | `blackbox.test.ts` verifies the ±15-second correlation window and exact no-anomaly result |
| Browser suspension | `blackbox.test.ts` and `blackboxScheduler.test.ts` separate late browser scheduling from reachability failure |
| Black Box persistence/quota | `blackboxSessions.test.ts` verifies retention, array bounds, interruption recovery, and actionable storage failure |
| Black Box controlled DNS and endpoint trace | `blackboxProbe.test.ts` verifies real-response parsing and that echoed public IP is not retained |

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
- Connection Black Box has no default independent second endpoint, persistent
  echo service, or cooperating UDP service. It therefore reports one-endpoint
  HTTPS reachability and leaves true packet loss unavailable.

## Current runtime validation (corrected aggregation and guided diagnostics)

A low-data production build was exercised through the local browser on
2026-07-19 after the adaptive-payload and Fix My Internet changes:

- All stages completed: preflight, server selection, idle latency, single and
  multi download, upload, UDP reachability, calculations, result rendering,
  diagnostic snapshot, deterministic evaluation, and local persistence.
- The diagnostic baseline measured 126 Mbps download, 17.0 Mbps upload, 43 ms
  idle latency, 109 ms download-loaded latency, 157 ms upload-loaded latency,
  8 ms jitter, 46/100 stability, 44.5 MB application payload, and 7.7 seconds.
- Ten idle, five download-loaded, and six upload-loaded samples produced 60%
  run confidence. The evidence view supported queueing under load at 60%
  confidence while keeping DNS, packet loss, independent routing, and outage
  conclusions unavailable.
- The selected Cloudflare EWR edge, HTTPS method, observed IPv4 family, sample
  counts, duration, payload, and confidence were visible in the session
  timeline. The same result appeared in shared test history after reload.
- The session survived reload, the mobile navigation sheet closed after route
  selection, dark/light themes rendered without horizontal overflow at desktop,
  tablet, and 375 px mobile widths, visible keyboard focus was present, and the
  browser console contained no warnings or errors.

## Connection Black Box runtime validation

The rebuilt production bundle was exercised locally on 2026-07-19 with a real
quick-scan session; no fixture or synthetic network result entered the UI:

- Fifty primary Cloudflare HTTPS probes ran on the configured two-second
  cadence. Pause held the sample count at 23 for more than one interval; resume
  advanced it to 25; stop preserved all 50 samples and 2.3 kB of measured
  application-response payload.
- The run recorded four successful controlled DNS-over-HTTPS observations and
  two Cloudflare endpoint observations. The latter showed IAD, an observed IPv4
  route, successful explicit IPv4 reachability, and unavailable/failed IPv6 on
  the validation network. No independent secondary or packet-loss value was
  invented.
- Real latency included 205 ms and 160 ms spikes. The stopped-session summary
  calculated median 45.1 ms, P95 98.2 ms, P99 183 ms, jitter 23.6 ms, quality
  88/100, and 96% evidence confidence. Incident cards grouped the associated
  latency and severe-jitter evidence into at least one two-second probe interval
  and showed severity, endpoint, confidence, and possible impact.
- An **I Felt Lag** marker correlated the surrounding 30-second window and
  reported the observed severe jitter while confirming foreground visibility.
  The exact no-anomaly behavior is covered by `blackbox.test.ts`.
- Reload recovered the stopped session from local storage. The raw table showed
  planned/start/completion timing, scheduler delay, visibility, reachability,
  latency, and explicitly unavailable secondary status. JSON, CSV, PDF-ready
  support data, text report, and bounded share-summary generators are covered by
  the automated suite.
- The setup, saved-session, telemetry, incident, raw-data, and report views
  rendered at 390 px mobile, 820 px tablet, and 1440 px desktop widths. The
  mobile navigation sheet closed after route selection. Light and dark root
  themes switched correctly; keyboard tab focus reached the theme control with
  a visible focus-ring class; all controls exposed semantic roles and names.
- The final rebuilt runtime, footer, monitoring profiles, and persisted session
  loaded with an empty browser console. Timer cleanup is tested by aborting the
  scheduler; storage and analysis are bounded, and a 5,000-sample summary stays
  within the test's 500 ms budget. Browser heap instrumentation is unavailable,
  so this is cleanup/bounds evidence rather than a claim of formal leak proof.

Scenarios requiring actual environmental conditions—full disconnection,
device sleep, VPN, IPv4-only/IPv6-capable networks, and mobile radio—remain
manual field checks. Deterministic probe, scheduling, storage, and classification
tests cover their observable result states without fabricating production data.

## Motion and responsive runtime validation

The rebuilt production bundle was exercised locally on 2026-07-21 with a real
low-data speed test. No fixture or synthetic measurement entered the UI:

- The run completed against Cloudflare edge EWR with 271 Mbps aggregate
  download, 24.3 Mbps upload, 46 ms idle latency, 110 ms download-loaded
  latency, 161 ms upload-loaded latency, 7.5 ms jitter, 45.4 MB of application
  payload, 39 stored events, and 78% confidence.
- The fixed four-band dial rendered 0, 100, 200, 500, and 3000+ scale labels.
  Its needle, active sweep, value, and payload indicator shared the orange
  200–500 Mbps state at completion. The old dynamic scale change and decorative
  center indicators were absent.
- Live throughput and latency charts appeared only after real samples arrived.
  Completed charts rendered from the same run, and the saved result persisted
  into History after route navigation.
- The shell had no document-level horizontal overflow at 390x844, 768x1024,
  1280x720, or 1440x900. Sidebar collapse/expand, dark/light themes, and the
  mobile shell all rendered; keyboard focus exposed a visible 2 px outline.
- The footer legal text rendered in full. The browser console contained no
  warnings or errors after the run and navigation checks.
