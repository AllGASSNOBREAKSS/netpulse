# NetPulse measurement pipeline (v2)

This document is the reference for **what NetPulse measures and how**. It is the
honest contract behind every number the UI shows.

> **NetPulse does not try to match Ookla, Fast.com, Cloudflare's own test, or
> M-Lab.** Those platforms use different servers, server counts, connection
> counts, and aggregation methods, so their numbers legitimately differ from
> each other and from NetPulse. We document our method and let the results
> stand on it.

## Pipeline stages

Each stage is a separate module under `src/lib/`. The orchestrator
(`engine.ts`) sequences them and streams events to the UI.

| # | Stage | Module | What it produces |
|---|-------|--------|------------------|
| 1 | Preflight | `preflight.ts` | Browser, OS, device class, tab foreground state, secure context, IPv4/IPv6 availability, connection type, explicit Cloudflare WARP signal where reported, other VPN/proxy status **unknown**, estimated duration + data |
| 2 | Server selection | `servers.ts` | Probes each registered candidate (latency samples + trace), ranks by median latency + jitter + availability, picks the best (or a manual choice) and explains why |
| 3 | Idle latency | `latency.ts` | 14 (10 low-data) zero-byte probes, `performance.now()` timed → min / median / mean / p95 / p99 / jitter / stddev / failed / count |
| 4 | Download | `throughput.ts` | Discarded warm-up; adaptive request size; **single-connection** then **multi-connection** run; cache-busted, no-store; received payload ÷ actual phase time; timed windows for median/P90/peak/variation; explicit stop reason |
| 5 | Upload | `throughput.ts` | Discarded generated-payload warm-up; adaptive POST size; parallel non-personal in-memory payloads; server-accepted payload ÷ actual phase time; cumulative accepted-payload observations and browser limitation labels |
| 6 | Loaded latency | `throughput.ts` | Continuous probes **during** download and upload, kept separate |
| 7 | UDP reachability | `packetloss.ts` | **Experimental** WebRTC/STUN connectivity check (see below) — not an end-to-end packet-loss percentage |
| 8 | Bufferbloat | `grading.ts` | Loaded − idle latency rise, **separate** for download and upload, graded A–F |
| 9 | Stability | `grading.ts` | 0–100 score from loaded-latency spread, spikes, worse down/up throughput variation, failed probes/requests, and completion; p95/p99; longest spike; probe completeness |
| 10 | Network identity | `engine.ts` + `networkIdentity.ts` | Automatic trace: serving edge, client country code, IP family, **masked** IP. ISP/ASN/city/region: validated, explicit opt-in lookup only |
| 11 | Confidence | `confidence.ts` | 0–100 trust score with exact visible deductions for sampling, variation, server stability, tab visibility, completion, and errors |
| 12 | Export | `export.ts` | Full JSON: config, candidates, per-metric stats, raw samples, scoring formula, methodology |

## Timing

All timing uses `performance.now()` — monotonic and sub-millisecond, unaffected
by wall-clock adjustments. Latency probes are zero-byte HTTPS round-trips; these
read slightly higher than raw ICMP ping because they include TLS/HTTP framing.

## Throughput method

- **Warm-up and adaptive sizing**: each direction performs a discarded transfer
  to prime connection setup and selects a bounded request payload targeting a
  useful transfer duration. Warm-up bytes are counted in data use but excluded
  from the timed throughput result.
- **Cache-busting**: every transfer carries a monotonic unique query string and
  `cache: "no-store"` so a cached body cannot become a measurement.
- **Single then multi connection**: a single stream reveals per-flow shaping; up
  to 4 parallel streams (2 in low-data) reveal the line's real ceiling. The
  headline figure is the multi-connection result.
- **Reported value**: application payload transferred or accepted divided by
  the phase's actual wall-clock duration. This includes ramp-up instead of
  selecting only faster windows. Download windows are retained for median,
  P90 capacity context, peak, and variation; the P90 is not substituted for
  the aggregate headline. Cloudflare's own test currently documents a P90
  method, which is one reason its headline may differ even on the same network.
  upload observations update only after a POST is accepted because Fetch does
  not expose byte-level upload progress.
- **Direction isolation**: download and upload run sequentially so each loaded-
  latency result can be attributed to one direction. Running them concurrently
  would be a different full-duplex stress test and would not make either
  directional capacity estimate more comparable to other services.
- **Worldwide scope**: the current provider is Cloudflare anycast. BGP routes
  each browser to a serving edge, but peering, congestion, device limits, and
  the chosen methodology still vary by country and ISP. NetPulse does not use
  private Ookla or Netflix endpoints and cannot promise identical results.
- **Early stopping**: for download, once the recent samples' coefficient of variation drops
  below 5% (after a minimum duration and ≥12 samples), the phase stops. This
  saves data without hurting accuracy, and is disclosed in the result.
- **Caps and stop reasons**: every phase has a hard duration cap and a payload
  target. Results retain whether a phase stopped because samples stabilized, the
  duration expired, the payload cap was reached, or all workers completed.
  Payload-capped phases that miss the minimum duration lose confidence. In-flight
  requests can overshoot slightly; displayed data is application payload
  including warm-ups, not exact on-wire usage.
- **Upload limitation**: Fetch exposes neither byte-level upload progress nor
  protocol overhead. Reliable upload is accepted payload divided by phase time.
  Median, peak observation, and variation use cumulative accepted-payload
  observations and are labeled as such rather than packet-level windows.

## UDP reachability — why packet loss remains unavailable

True packet loss requires a sustained UDP flow against a cooperating echo/TURN
server, which NetPulse does not run yet. Estimating loss from failed HTTP
requests would be **wrong**, so we don't. Instead the UDP-reachability card runs a
real, related check: a WebRTC `RTCPeerConnection` gathers ICE candidates against
public STUN servers. A server-reflexive (`srflx`) candidate means UDP can leave
your network and reach a STUN server, and we time how long that took. This is
labeled **experimental** and explicitly is **not** a loss percentage. For a real
loss figure, the card points users to `ping -n 50 1.1.1.1` (or `-c 50`).

## Health score

The 0–100 score is defined in **one** file, `src/lib/scoring.ts`, as seven
weighted components: download 24, upload 16, idle latency 12, loaded
latency/bufferbloat 20, jitter 8, stability 8, and run confidence 12. Packet
loss appears as an explicit zero-weight, unscored row because no valid loss
measurement exists. Clicking the score renders the same inputs, rules, and
earned/possible points that the calculation uses.

## Privacy

The full public IP is **never** stored in results or exported — only a masked
form (`68.197.•••.•••`). Cloudflare's automatic trace supplies its serving edge
code and a client country code; neither is mislabeled as a city or retail ISP.
The Connection & Privacy view can optionally contact `ipwho.is` for ISP, ASN,
and approximate area. That request occurs only after an explicit click and the
UI discloses that the provider will see the requesting public IP. Returned IPs
are immediately masked and the metadata is not stored in history or exports.

## What NetPulse cannot do from a browser

SSID, Wi-Fi password, radio channel, signal strength, nearby networks, router
model, and the list of LAN devices are all inaccessible to a sandboxed web page.
NetPulse never claims otherwise. See [AUDIT.md](AUDIT.md) for the full honesty
review and [VALIDATION.md](VALIDATION.md) for the test matrix.

## Connection Black Box

The long-run monitor is a separate, low-data observability pipeline under
`src/lib/blackbox*.ts`. It records monotonic-scheduled HTTPS round trips,
controlled DNS-over-HTTPS transactions, Cloudflare edge and IP-family
observations, page visibility, and browser scheduling delay. It does not reuse
speed-test values or synthesize missing samples. Detailed modes, formulas,
incident thresholds, data budgets, persistence rules, exports, and browser
limitations are documented in [BLACKBOX.md](BLACKBOX.md).
