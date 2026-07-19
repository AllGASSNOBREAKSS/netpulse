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
| 1 | Preflight | `preflight.ts` | Browser, OS, device class, tab foreground state, secure context, IPv4/IPv6 availability, connection type, **possible** VPN/proxy (heuristic), estimated duration + data |
| 2 | Server selection | `servers.ts` | Probes each registered candidate (latency samples + trace), ranks by median latency + jitter + availability, picks the best (or a manual choice) and explains why |
| 3 | Idle latency | `latency.ts` | 14 (10 low-data) zero-byte probes, `performance.now()` timed → min / median / mean / p95 / p99 / jitter / stddev / failed / count |
| 4 | Download | `throughput.ts` | **Single-connection** then **multi-connection** run; cache-busted, no-store; timed ~250 ms windows plus a final partial window; representative = top-half median; peak; CoV; payload bytes; early-stop on steadiness; duration/data caps |
| 5 | Upload | `throughput.ts` | Parallel POST of in-memory random payloads; reliable + peak throughput; consistency; accepted payload bytes |
| 6 | Loaded latency | `throughput.ts` | Continuous probes **during** download and upload, kept separate |
| 7 | Packet loss | `packetloss.ts` | **Experimental** WebRTC/STUN UDP-reachability check (see below) — not an end-to-end loss % |
| 8 | Bufferbloat | `grading.ts` | Loaded − idle latency rise, **separate** for download and upload, graded A–F |
| 9 | Stability | `grading.ts` | 0–100 score from latency stddev + spikes + throughput variation; p95/p99; longest spike |
| 10 | ISP / location | `engine.ts` + trace | Approximate IP-based city/region, IP family, **masked** IP, possible VPN/proxy — clearly labeled approximate |
| 11 | Confidence | `confidence.ts` | 0–100 trust score from sample volume, result variation, server stability, tab visibility, completion, errors |
| 12 | Export | `export.ts` | Full JSON: config, candidates, per-metric stats, raw samples, scoring formula, methodology |

## Timing

All timing uses `performance.now()` — monotonic and sub-millisecond, unaffected
by wall-clock adjustments. Latency probes are zero-byte HTTPS round-trips; these
read slightly higher than raw ICMP ping because they include TLS/HTTP framing.

## Throughput method

- **Cache-busting**: every download request carries a random query string and
  `cache: "no-store"` so no intermediary can serve a cached body.
- **Single then multi connection**: a single stream reveals per-flow shaping; up
  to 4 parallel streams (2 in low-data) reveal the line's real ceiling. The
  headline figure is the multi-connection result.
- **Reported value**: median of the top half of 250 ms samples — this discards
  TCP slow-start without cherry-picking the single peak.
- **Early stopping**: once the recent samples' coefficient of variation drops
  below 5% (after a minimum duration and ≥12 samples), the phase stops. This
  saves data without hurting accuracy, and is disclosed in the result.
- **Caps**: every phase has a hard duration cap and a payload target. In-flight parallel requests can overshoot the payload target slightly, and browser APIs cannot expose request framing or partially sent aborted uploads, so the displayed data figure is measured application payload rather than exact on-wire usage.

## Packet loss — why it's experimental

True packet loss requires a sustained UDP flow against a cooperating echo/TURN
server, which NetPulse does not run yet. Estimating loss from failed HTTP
requests would be **wrong**, so we don't. Instead the packet-loss card runs a
real, related check: a WebRTC `RTCPeerConnection` gathers ICE candidates against
public STUN servers. A server-reflexive (`srflx`) candidate means UDP can leave
your network and reach a STUN server, and we time how long that took. This is
labeled **experimental** and explicitly is **not** a loss percentage. For a real
loss figure, the card points users to `ping -n 50 1.1.1.1` (or `-c 50`).

## Health score

The 0–100 score is defined in **one** file, `src/lib/scoring.ts`, as six
weighted components (download 28, bufferbloat 24, upload 20, idle latency 14,
jitter 8, stability 6). Clicking the score in the app renders that exact table —
measured input, rule, and earned/possible points per component.

## Privacy

The full public IP is **never** stored or exported — only a masked form
(`68.197.•••.•••`). IP-based location is approximate and reflects the network's
routing region (often an ISP point of presence), not a street address.

## What NetPulse cannot do from a browser

SSID, Wi-Fi password, radio channel, signal strength, nearby networks, router
model, and the list of LAN devices are all inaccessible to a sandboxed web page.
NetPulse never claims otherwise. See [AUDIT.md](AUDIT.md) for the full honesty
review and [VALIDATION.md](VALIDATION.md) for the test matrix.
