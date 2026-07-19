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
real megabytes the test consumed.

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

| Metric | How |
| --- | --- |
| Download / upload throughput | Parallel streams to `speed.cloudflare.com`, median of the top-half samples (ignores TCP ramp-up) |
| Idle latency + jitter | Timed zero-byte probes; median + mean absolute delta |
| **Loaded latency (bufferbloat)** | Latency probed *while saturating* download, then upload; graded **A–F** |
| Stability | Count of latency spikes during load |
| Data used | Bytes transferred, shown per test |

From those it derives a **0–100 health score**, eight **real-world activity
grades** (competitive gaming, gaming-while-downloading, 4K streaming, video
calls, cloud gaming, livestreaming, large uploads, everyday browsing), a
plain-English diagnosis, and prioritized fixes.

## Features

- 📡 Real measurement engine — every displayed metric is measured or derived
  from measurements; anything that can't be measured says so (see packet loss)
- 🏎️ Animated automotive speedometer — spring-physics needle, auto-scaling dial
  (240 → 500 → 1000+ Mbps), redline zone, phase "gear" indicator showing the
  stream count that actually ran, data-used fuel bar
- 🔍 Interactive metric cards — click any of the 11 metrics for what it means,
  how it was measured, your result, healthy ranges, raw samples, and a
  recommended next action
- 🧮 Transparent health score — the formula lives in one documented file
  ([`src/lib/scoring.ts`](src/lib/scoring.ts)); click the score for a full
  per-component breakdown with weights
- 🧭 Collapsible dashboard sidebar: Speed test · Latency monitor · Devices ·
  Connection & Privacy · History
- 📉 Live latency monitor — continuous 500 ms probes with spike/drop detection,
  run it while you game or join calls
- 🔒 Connection & Privacy panel — public IP (masked by default, reveal on
  demand), nearest edge, TLS/HTTP version, WARP detection — presented as
  neutral connection facts, not scare-words
- 🩺 Activity grades and a written diagnosis with a "don't waste money on" callout
- 🧾 Local test history (stored in your browser, never uploaded)
- 🪫 Low-data mode — caps a full test from ~240 MB down to ~35 MB for metered connections
- ♿ Responsive (desktop/tablet/mobile), keyboard-accessible, honors `prefers-reduced-motion`

## Honest limitations

- **Packet loss isn't shown.** Browsers can't measure it reliably without a
  special server protocol, so it's deliberately omitted rather than faked. The
  packet-loss card explains this and points to an OS-level alternative.
- The browser can't read Wi-Fi radio details (SSID, band, signal strength) —
  that would need a native companion app. NetPulse tests the *connection*, not
  the radio.
- Low-data mode on fast connections hits its byte caps quickly, so
  latency-under-load figures rest on fewer probes — the app tells you when
  that happened. Run a full test for solid numbers.
- Results depend on the test server (Cloudflare's nearest edge) and your
  device; treat them as a consistent relative baseline, not an absolute truth.

A full audit of the codebase — architecture, measurement sources, what was
found and fixed, and remaining limitations — lives in [AUDIT.md](AUDIT.md).

## Getting started

```bash
git clone https://github.com/bbarc0de/netpulse.git
cd netpulse
npm install
npm run dev        # http://localhost:5178
```

Build for production:

```bash
npm run build      # outputs to dist/
npm run preview
```

No API keys, no backend, no account — it runs entirely in the browser.

## Tech

Vite · React · TypeScript · SVG. Zero runtime dependencies beyond React.
Measurements use the Cloudflare speed endpoints (`__down` / `__up`), the same
infrastructure behind [speed.cloudflare.com](https://speed.cloudflare.com).

## Roadmap

- **Truth Mode** — test several endpoints and explain why results disagree
- **Fix My Internet** — guided A/B diagnostics (near router vs. far, Wi-Fi vs. Ethernet, VPN on/off)
- **Household Stress Lab** — simulate real simultaneous usage and see what breaks first
- **Connection Black Box** — long-run monitoring with an "I felt lag" marker
- **ISP Proof Pack** — scheduled peak-hour tests → downloadable evidence report

## License

[MIT](LICENSE) © bbarc0de
