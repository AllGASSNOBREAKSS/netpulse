# NetPulse

**An internet health console, not another speed test.**

**Live: [netpulse-psi.vercel.app](https://netpulse-psi.vercel.app)**

Most speed tests hand you three numbers and walk away. NetPulse runs a full
diagnostic against Cloudflare's public speed endpoints — measuring not just how
*fast* your connection is, but how it behaves **under load** — then explains in
plain English what's good, what's wrong, and what to actually do about it.

The signature is an automotive instrument cluster: a 270° speedometer driven
only by live throughput samples. A non-overshooting visual filter keeps the
needle, number, and active color synchronized without changing the measured
result. The fixed scale uses blue for 0–100 Mbps, yellow for 100–200, orange for
200–500, and red for 500 Mbps and above; it never rescales during a run. The
payload bar counts application data the browser can observe, not protocol
overhead.

```
             332 Mbps          ← needle and number move together
          health 79/100
         ▬▬▬▬▬▬  349 MB       ← data actually moved, byte-counted
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
| Preflight | Browser, OS, device, tab state, IPv4/IPv6 availability, secure context, explicit Cloudflare WARP signal where reported, other VPN/proxy status **unknown**, estimated duration + data |
| Server selection | Probes candidates, ranks by median latency + jitter + availability, explains the pick |
| Idle latency | Timed zero-byte probes (`performance.now()`) → min / median / mean / **P95 / P99** / jitter |
| Download | **Single- then multi-connection**, cache-busted, no-store; received payload ÷ actual phase time, with timed windows for variation |
| Upload | Parallel POST of non-compressible in-memory payloads; server-accepted payload ÷ actual phase time |
| Loaded latency | Probed *while saturating* download, then upload — kept **separate** |
| Bufferbloat | Loaded − idle rise, **separate download/upload grades A–F** |
| Stability | 0–100 from latency stddev + spikes + throughput variation; P95/P99; longest spike |
| Packet loss | **Unavailable** without a cooperating UDP echo endpoint; an experimental WebRTC/STUN reachability signal is kept separate and never shown as loss |
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
- 🧭 Responsive shadcn/ui dashboard shell with a collapsible desktop sidebar,
  mobile drawer, keyboard navigation, theme controls, and honest disabled states
  for planned workflows
- 📈 Live and completed real-data charts for latency, throughput, idle-versus-loaded latency,
  stability, and locally saved previous-test comparison
- 🛡️ **Connection Black Box** — real long-run HTTPS latency, reachability,
  controlled DNS, edge, browser-scheduling, and visibility telemetry with
  deterministic incident grouping, an **I Felt Lag** correlation marker,
  local retention, raw tables, and privacy-safe support exports. See
  [BLACKBOX.md](BLACKBOX.md)
- 📍 **Area Pulse** — fail-closed, privacy-thresholded coarse regional reports,
  real browser reachability checks, signed official notices, transparent
  confidence, deletion receipts, and abuse controls. It renders honest list and
  empty states, never a fake outage map. See [AREA_PULSE.md](AREA_PULSE.md)
- 🔒 Connection & Privacy panel — public IP (masked by default), nearest edge,
  TLS/HTTP version, and WARP detection; ISP/ASN/approximate area is a separate,
  privacy-disclosed opt-in lookup and is never inferred from the edge code
- 🛰️ Preflight + server selection panel — environment facts and *why* this
  server was chosen, shown before the numbers
- 🎯 Result confidence score with exact per-factor deductions so you know how
  much to trust a run
- 📤 Methodology & raw-data panel — server candidates, per-run limitations, the
  full method, privacy-safe JSON/CSV exports, and a diagnostic text report
- 🩺 Activity grades and a written diagnosis with a "don't waste money on" callout
- 🧾 Local test history (stored in your browser, never uploaded)
- 📊 **ISP Plan Reality Check** — local-history medians, peak/off-peak and
  user-labeled Wi-Fi/Ethernet comparisons, confidence exclusions, loaded
  latency, and a neutral support report without contractual claims
- 🛠️ **Fix My Internet** — a deterministic guided workflow with real baseline
  and A/B measurements, locally saved sessions, evidence/confidence/alternatives
  for every conclusion, a prioritized retestable fix plan, and privacy-safe
  reports. See [DIAGNOSTICS.md](DIAGNOSTICS.md)
- 🪫 Low-data mode — typically ~40 MB instead of ~250 MB; preflight also shows
  each profile's configured payload ceiling before possible in-flight overshoot
- 🧪 Unit-tested measurement logic (`npm test`) — see [VALIDATION.md](VALIDATION.md)
- ♿ Responsive (desktop/tablet/mobile), keyboard-accessible, honors `prefers-reduced-motion`

## Honest limitations

- **Packet loss is unavailable.** True end-to-end loss needs a UDP echo server
  NetPulse doesn't run. A separate experimental **UDP reachability** signal performs a
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
[AUDIT.md](AUDIT.md) (codebase honesty audit) ·
[SECURITY_AUDIT.md](SECURITY_AUDIT.md) (threat model and release gates) ·
[DIAGNOSTICS.md](DIAGNOSTICS.md) (troubleshooting rules) ·
[BLACKBOX.md](BLACKBOX.md) (long-run observability method) ·
[AREA_PULSE.md](AREA_PULSE.md) (regional architecture and plan formulas) ·
[POLICIES.md](POLICIES.md) (policy index and contact).

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

Core speed testing, history, diagnostics, plan comparison, and Black Box data are
local-first and require no account. The optional Area Pulse architecture uses
same-origin Vercel Functions, PostgreSQL, and Cloudflare Turnstile; it fails
closed and remains unavailable unless every required server control is
configured. Never put server secrets in `VITE_*` variables.

## Tech

Vite · React · TypeScript · Tailwind CSS · shadcn/ui · selected ARC UI web
components · Recharts · SVG · Vitest. Throughput/latency use the Cloudflare speed endpoints (`__down` /
`__up`), the same infrastructure behind
[speed.cloudflare.com](https://speed.cloudflare.com); the experimental
packet-loss card uses WebRTC against public STUN servers. Run `npm test` for the
measurement-logic suite.

Space Grotesk (SIL Open Font License) is bundled for display typography, with
Geist for body copy and a system monospace stack for technical values. Glonto
is a commercial font and is not bundled or redistributed without a licensed
webfont supplied by the project owner.

The engine is modular under `src/lib/` — `preflight`, `servers`, `latency`,
`throughput`, `grading`, `packetloss`, `confidence`, `scoring`, `stats`, with
`engine.ts` sequencing them.

The interface uses centralized light/dark/system tokens in `src/styles.css`.
shadcn/ui owns interactive primitives and charts; ARC UI is limited to telemetry
and status elements so the two systems do not compete for the same primitive.
Theme and sidebar preferences are stored locally.

## Security and privacy

Read [SECURITY.md](SECURITY.md) before reporting a vulnerability. Operational
and legal-readiness documents include [PRIVACY.md](PRIVACY.md),
[TERMS.md](TERMS.md), [ACCEPTABLE_USE.md](ACCEPTABLE_USE.md),
[TRADEMARKS.md](TRADEMARKS.md), [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md),
[DATABASE_RUNBOOK.md](DATABASE_RUNBOOK.md), and
[DEPLOYMENT_RUNBOOK.md](DEPLOYMENT_RUNBOOK.md). Policy drafts are explicitly
subject to qualified legal review; the project does not claim certification or
perfect security.

## Roadmap

- **Truth Mode** — test several endpoints and explain why results disagree
- **Household Stress Lab** — simulate real simultaneous usage and see what breaks first
- **ISP Proof Pack** — scheduled peak-hour tests → downloadable evidence report

## License

NetPulse is licensed under the [GNU Affero General Public License v3.0 only](LICENSE)
(`AGPL-3.0-only`).

© 2026 NetPulse and contributors.
