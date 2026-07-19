# NetPulse validation

Automated tests cover the **pure measurement logic** — the code that turns
samples into results, grades, scores, and confidence. Network-dependent and
environmental scenarios are validated manually because they can't be reproduced
deterministically in CI without fabricating measurements (which the production
app never does).

## Running the automated suite

```bash
npm run check     # typecheck + zero-warning lint + tests + production build
npm test          # vitest run — 31 tests across 6 files
npm run test:watch
```

Test files live in `src/lib/__tests__/`:

| File | Covers |
|------|--------|
| `stats.test.ts` | median, percentile (P95/P99), mean, stddev, jitter, top-half median, summarize |
| `grading.test.ts` | bufferbloat A–F boundaries, separate down/up grades, stability steady-vs-spiky |
| `scoring.test.ts` | weight sum = 100, fast/slow/high-latency/bufferbloat cases, per-component caps |
| `confidence.test.ts` | foreground vs background, complete vs interrupted, sample volume, errors/server |
| `servers.test.ts` | ranking by latency+jitter/reachability, intermittent and unavailable candidates, IPv4/IPv6 carried through |
| `throughput.test.ts` | fast byte-capped final windows, loaded probe retention, HTTP endpoint failure handling, upload final window |

## Scenario matrix

Each required scenario, and how it is validated. **Fixtures are used only in
these tests and never in the production UI.**

| Scenario | How it's validated |
|----------|--------------------|
| Fast connection | `scoring.test.ts` (high throughput → high score); `stats.test.ts` top-half median |
| Slow connection | `scoring.test.ts` (low throughput → low score) |
| High latency | `scoring.test.ts` (idle latency drags score); idle-latency bands in `metrics.ts` |
| High jitter | `grading.test.ts` stability spiky case; jitter in `stats.test.ts` |
| Packet loss | `packetloss.ts` returns experimental UDP signal; verified manually (UDP OK / blocked / unknown) |
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

## Manual validation performed (2026-07-19)

Full low-data run on a real connection, driven through the live DOM:

- Pipeline progressed through every phase: server → idle → download single →
  download multi → upload → UDP check → complete.
- Results: download single 185 / multi 271 Mbps, upload 32 (peak 64), idle 44 ms
  (p95 51, min 36), download-loaded 134 ms (+90), upload-loaded 112 ms (+68),
  jitter 6.7 ms, bufferbloat C (down C / up C), stability 25/100 (2 spikes),
  packet loss UDP OK (STUN 41 ms), duration 6.1 s, data 42 MB.
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
- Environmental scenarios (VPN, mobile, Wi-Fi/Ethernet) rely on manual runs;
  they cannot be faithfully automated without synthetic network conditions.
