# NetPulse

**An internet health console, not another speed test.**

**Live: [netpulse-psi.vercel.app](https://netpulse-psi.vercel.app)**

Most speed tests hand you three numbers and walk away. NetPulse runs a full
diagnostic against Cloudflare's public speed endpoints — measuring not just how
*fast* your connection is, but how it behaves **under load** — then explains in
plain English what's good, what's wrong, and what to actually do about it.

The signature is an automotive instrument cluster: a 270° speedometer whose
needle is driven by spring physics, revving on live throughput samples like an
RPM gauge. The red ring badge is your idle ping, the gear indicator shows the
test phase (`D3` download, `U2` upload, `N` done), and the fuel bar counts the
application payload the browser can observe (not protocol overhead).

```
        ⌀ 332 MBPS  [N]        ← needle settles on your measured download
   (44)              health 79/100
        ▮▯ ▬▬▬▬▬▬  349 MB     ← data actually moved, byte-counted
```

---

## Why it's different

A connection can post an impressive download number and still feel terrible for
gaming, calls, or streaming. The usual culprit is **bufferbloat** — latency that
balloons the moment the line gets busy — and a 20-second "max speed" test hides
it completely. NetPulse measures it and grades it.

Instead of:

```
Download: 216 Mbps   Upload: 128 Mbps   Ping: 80 ms
```

you get:

> **Score 79/100 — Solid all-round connection.** Strong download and upload, but
> idle latency is high (80 ms) and one spike appeared under load. Competitive
> gaming will feel it; 4K streaming and large uploads are excellent.
> **Don't waste money on** a faster plan — bandwidth isn't your bottleneck.

## What it measures

A staged pipeline — full detail in **[ENGINE.md](ENGINE.md)**:

| Stage | How |
| --- | --- |
| Preflight | Browser, OS, device, tab state, IPv4/IPv6 availability, secure context, **possible** VPN/proxy (heuristic), estimated duration + data |
| Server selection | Probes candidates, ranks by median latency + jitter + availability, explains the pick |
| Idle latency | Timed zero-byte probes (`performance.now()`) → min / median / mean / **P95 / P99** / jitter |
| Download | **Single- then multi-connection**, cache-busted, no-store; received payload ÷ actual phase time, with timed windows for variation |
| Upload | Parallel POST of non-compressible in-memory payloads; server-accepted payload ÷ actual phase time |
| Loaded latency | Probed *while saturating* download, then upload — kept **separate** |
| Bufferbloat | Loaded − idle rise, **separate download/upload grades A–F** |
| Stability | 0–100 from latency stddev + spikes + throughput variation; P95/P99; longest spike |
| UDP reachability | **Experimental** WebRTC/STUN check — *not* an end-to-end packet-loss percentage |
| Confidence | 0–100 trust score with every deduction shown: sampling, variation, server stability, tab visibility, completion, errors |

From the results it derives a **transparent 0–100 health score** (formula in one
file, [`src/lib/scoring.ts`](src/lib/scoring.ts)), eight **real-world activity
grades**, a plain-English diagnosis, and prioritized fixes. Everything is
inspectable and exportable as JSON.

> NetPulse is **not** tuned to match Ookla, Fast.com, Cloudflare's own test, or
> M-Lab — they use different servers and methods, so results legitimately
> differ. The method is documented instead of hidden.

## Features

- 📡 Real measurement engine — every card is visibly labeled **measured**,
  **calculated**, or **experimental**; unsupported metrics are never invented
- 🏎️ Animated automotive speedometer — spring-physics needle, auto-scaling dial
  (240 → 500 → 1000+ Mbps), redline zone, phase "gear" indicator showing the
  stream count that actually ran, measured-payload fuel bar
- 🔍 Interactive metric cards — click any of the 11 metrics for what it means,
  how it was measured, your result, healthy ranges, raw samples, and a
  recommended next action
- 🧮 Transparent health score — the formula lives in one documented file
  ([`src/lib/scoring.ts`](src/lib/scoring.ts)); click the score for a full
  per-component breakdown with weights
- 🧭 Collapsible dashboard sidebar: Speed test · Latency monitor · Connection &
  Privacy · History
- 📉 Live latency monitor — continuous 500 ms probes with spike/drop detection,
  run it while you game or join calls
- 🔒 Connection & Privacy panel — public IP (masked by default), nearest edge,
  TLS/HTTP version, and WARP detection; ISP/ASN/approximate area is a separate,
  privacy-disclosed opt-in lookup and is never inferred from the edge code
- 🛰️ Preflight + server selection panel — environment facts and *why* this
  server was chosen, shown before the numbers
- 🎯 Result confidence score with exact per-factor deductions so you know how
  much to trust a run
- 📤 Methodology & raw-data panel — server candidates, per-run limitations, the
  full method, and one-click JSON export (raw samples included, public IP never)
- 🩺 Activity grades and a written diagnosis with a "don't waste money on" callout
- 🧾 Local test history (stored in your browser, never uploaded)
- 🪫 Low-data mode — caps a full test from ~250 MB down to ~40 MB for metered connections
- 🧪 Unit-tested measurement logic (`npm test`) — see [VALIDATION.md](VALIDATION.md)
- ♿ Responsive (desktop/tablet/mobile), keyboard-accessible, honors `prefers-reduced-motion`

## Honest limitations

- **Packet loss is unavailable.** True end-to-end loss needs a UDP echo server
  NetPulse doesn't run. The experimental **UDP reachability** card performs a
  real WebRTC/STUN connectivity check and points to an OS-level `ping`; it never
  invents a loss percentage.
- Browser fetch exposes received download chunks, but not byte-level upload
  progress. Upload is therefore accepted application payload divided by the
  full phase time; aborted partial uploads and protocol overhead are excluded.
- The browser can't read Wi-Fi radio details (SSID, band, signal strength) —
  that would need a native companion app. NetPulse tests the *connection*, not
  the radio.
- Low-data mode on fast connections hits its byte caps quickly, so
  latency-under-load figures rest on fewer probes — the app tells you when
  that happened. Run a full test for solid numbers.
- Results depend on the test server (Cloudflare's nearest edge) and your
  device; treat them as a consistent relative baseline, not an absolute truth.

**Docs:** [ENGINE.md](ENGINE.md) (measurement pipeline) ·
[VALIDATION.md](VALIDATION.md) (test matrix) ·
[AUDIT.md](AUDIT.md) (codebase honesty audit).

## Getting started

```bash
git clone https://github.com/bbarc0de/netpulse.git
cd netpulse
npm install
npm run dev        # http://localhost:5178
```

Build for production:

```bash
npm run check      # typecheck + lint + unit tests + production build
npm run build      # outputs to dist/
npm run preview
```

No API keys, no backend, no account — it runs entirely in the browser.

## Tech

Vite · React · TypeScript · SVG · Vitest. Zero runtime dependencies beyond
React. Throughput/latency use the Cloudflare speed endpoints (`__down` /
`__up`), the same infrastructure behind
[speed.cloudflare.com](https://speed.cloudflare.com); the experimental
packet-loss card uses WebRTC against public STUN servers. Run `npm test` for the
measurement-logic suite.

The engine is modular under `src/lib/` — `preflight`, `servers`, `latency`,
`throughput`, `grading`, `packetloss`, `confidence`, `scoring`, `stats`, with
`engine.ts` sequencing them.

## Roadmap

- **Truth Mode** — test several endpoints and explain why results disagree
- **Fix My Internet** — guided A/B diagnostics (near router vs. far, Wi-Fi vs. Ethernet, VPN on/off)
- **Household Stress Lab** — simulate real simultaneous usage and see what breaks first
- **Connection Black Box** — long-run monitoring with an "I felt lag" marker
- **ISP Proof Pack** — scheduled peak-hour tests → downloadable evidence report

## License

NetPulse is licensed under the [GNU Affero General Public License v3.0 only](LICENSE)
(`AGPL-3.0-only`).

© 2026 NetPulse and contributors.
