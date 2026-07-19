# NetPulse technical and measurement audit

**Date:** 2026-07-19 · **Scope:** architecture, production measurements, privacy,
scoring, accessibility, tests, and deployment readiness.

## Architecture

NetPulse is a static Vite/React/TypeScript application. `src/lib/engine.ts`
sequences the browser-only measurement pipeline; focused modules implement
preflight, server selection, latency, throughput, grading, confidence, scoring,
and export. React components render four views: speed test, latency monitor,
Connection & Privacy, and local history. Results and sidebar preferences are
stored only in `localStorage`; there is no application backend or analytics.

The only production throughput provider is Cloudflare's anycast speed endpoint.
The registry supports multiple candidates, but the UI and per-run limitations
state that only one provider is currently configured.

## Production measurement inventory

| Displayed result | Status | Source or calculation |
| --- | --- | --- |
| Download speed | Measured | Streamed bytes from cache-busted `GET /__down`, divided by actual phase time; single and multi-connection phases remain separate |
| Upload speed | Measured | POST payload bytes accepted by `/__up`, divided by actual phase time; no byte-level progress or peak is claimed |
| Idle latency | Measured | Sequential zero-byte HTTPS round trips timed with `performance.now()` after a discarded connection warm-up |
| Download-loaded latency | Measured | HTTPS probes that begin after download traffic is in flight |
| Upload-loaded latency | Measured | HTTPS probes that begin after upload traffic is in flight |
| Jitter | Calculated | Mean absolute difference between consecutive idle-latency probes |
| Bufferbloat | Calculated | Separate download/upload loaded medians minus idle median; negative rises clamp to zero; worse grade is displayed |
| Stability | Calculated | Loaded-latency spread, spike ratio, and worse down/up throughput variation |
| UDP reachability | Experimental | WebRTC/STUN ICE gathering; not packet loss and never displayed as a percentage |
| Confidence | Calculated | Observable run quality with exact per-factor deductions shown in the UI |
| Health score | Calculated | Six documented weighted rules from `src/lib/scoring.ts`; the UI renders the same inputs, rules, and points |
| Data transferred | Measured | Live and final application-payload byte counters from the engine; protocol overhead and aborted partial uploads are excluded |
| Test server | Measured metadata | Provider, Cloudflare serving-edge code, client country code, protocol, IP family, probe availability, and HTTPS latency |
| Public IP | Measured metadata | Echoed by Cloudflare, masked by default, never stored in test results or exports in full |
| ISP / ASN / approximate area | Optional estimate | Explicit user-initiated `ipwho.is` lookup; validated response, masked IP, no history/export persistence |

## Mocked, random, hard-coded, or unsupported values

- No production result is populated from a fixture, random number, timeout, or
  placeholder.
- `Math.random()` is used only to create a cache-busting download query string;
  it does not feed a result.
- Web Crypto fills upload bodies with non-compressible, non-personal bytes; the
  bytes are traffic, not synthetic result values.
- Configuration constants define sample cadence, time/byte caps, score weights,
  and documented grade thresholds. They do not substitute for measurements.
- Preflight duration/data figures are explicitly estimates shown before a run.
- Browser connection type and VPN/proxy status are best-effort hints and are
  labeled as such.
- Packet loss, Wi-Fi signal/SSID, router details, LAN devices, outages, and
  vulnerability scanning are not claimed.

## Accuracy fixes completed in this audit

1. Replaced the live data-use estimate derived from Mbps with cumulative counted
   application bytes from the engine.
2. Replaced upper-half sample selection with total transferred/accepted payload
   divided by actual phase duration, avoiding upward selection bias.
3. Upload progress now updates from cumulative server-accepted payload; the UI
   no longer presents an unsupported upload peak.
4. Load requests start before loaded-latency probes, preventing an idle probe
   from entering the loaded sample set.
5. Latency, server, trace, and optional metadata requests have bounded timeouts.
6. Renamed the packet-loss card to **UDP reachability** while retaining the
   experimental warning and explicit non-loss explanation.
7. Replaced misleading server `city`/`region` fields with serving-edge code and
   client country code.
8. ISP, ASN, city, and region are never inferred from Cloudflare edge metadata.
   The optional enrichment requires an explicit privacy-disclosed action.
9. Confidence separates download/upload and loaded-latency sampling, uses the
   previously ignored idle sample count, and displays every applied deduction.
10. The health score's stability component now uses the same comprehensive
    stability score shown on the metric card.

## Privacy and security

- Public IP is masked by default. Reveal is a deliberate button action.
- Full IP is not placed in test results, history, JSON exports, or logs.
- Automatic diagnostics contact Cloudflare for measurement and trace data.
- The optional IP metadata request is not automatic. The UI names `ipwho.is`,
  explains that it sees the requesting public IP, masks the returned IP, and
  does not persist the response.
- Google Fonts remains a third-party request and should be self-hosted in a
  future privacy/performance pass.
- `vercel.json` defines CSP, Permissions Policy, Referrer Policy, MIME-sniffing,
  framing, and HSTS headers. The CSP permits only the documented measurement,
  optional lookup, and font origins.

## Accessibility and layout

The existing racing-inspired cluster, responsive grid, and keyboard-operable
metric buttons are preserved. Metric cards now expose provenance as measured,
calculated, or experimental. The health-score breakdown has a visible report
button in addition to the clickable dial score. Known remaining accessibility
gaps are the modal focus trap and non-visual alternatives for graph strips.

## Remaining limitations and next priorities

1. True packet loss requires a cooperating UDP/TURN measurement service.
2. A second independent CORS-capable throughput provider is needed for useful
   multi-provider comparison; fake server candidates must not be added.
3. Browser Fetch cannot expose upload progress or exact on-wire usage.
4. Environmental scenarios such as Wi-Fi versus Ethernet, VPN, mobile, and
   background throttling require manual live runs.
5. Self-host fonts, add a modal focus trap, and provide textual probe-series
   alternatives.
6. Repeat controlled live full/low-data runs after deployment and record results
   without treating one connection as universal validation.

## Validation gate

Every implementation stage must pass TypeScript, zero-warning ESLint, Vitest,
and the Vite production build. See [VALIDATION.md](VALIDATION.md) for the current
automated matrix and live-check status.
