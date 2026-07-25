# NetPulse technical and measurement audit

**Date:** 2026-07-19 · **Scope:** architecture, production measurements, privacy,
scoring, accessibility, tests, and deployment readiness.

## Architecture

NetPulse is primarily a static Vite/React/TypeScript application. `src/lib/engine.ts`
sequences the browser-only measurement pipeline; focused modules implement
preflight, server selection, latency, throughput, grading, confidence, scoring,
and export. A separate low-data Connection Black Box pipeline implements
scheduled long-run HTTPS, controlled DNS, endpoint, visibility, and browser
scheduling observations. React components render the speed test, Connection
Black Box, guided diagnostics, Connection & Privacy, and local history. Results and sidebar preferences are
stored in `localStorage`; there is no account system or analytics. The optional
Area Pulse design adds same-origin Vercel Functions and PostgreSQL for explicit
anonymous regional reports. It is fail-closed until its database, privacy HMAC,
Turnstile, and exact hostname controls are configured; see
[SECURITY_AUDIT.md](SECURITY_AUDIT.md).

The only production throughput provider is Cloudflare's anycast speed endpoint.
The registry supports multiple candidates, but the UI and per-run limitations
state that only one provider is currently configured.

## Production measurement inventory

| Displayed result | Status | Source or calculation |
| --- | --- | --- |
| Download speed | Measured | Discarded warm-up and adaptive request sizing; streamed bytes from cache-busted `GET /__down`, divided by actual phase time; separate single/multi phases and timed median/peak/variation |
| Upload speed | Measured | Discarded generated-payload warm-up and adaptive POST size; payload accepted by `/__up`, divided by actual phase time; cumulative accepted observations provide explicitly labeled median/peak observation/variation because Fetch has no byte-level progress |
| Idle latency | Measured | Sequential zero-byte HTTPS round trips timed with `performance.now()` after a discarded connection warm-up |
| Download-loaded latency | Measured | HTTPS probes that begin after download traffic is in flight |
| Upload-loaded latency | Measured | HTTPS probes that begin after upload traffic is in flight |
| Jitter | Calculated | Mean absolute difference between consecutive idle-latency probes |
| Bufferbloat | Calculated | Separate download/upload loaded medians minus idle median; negative rises clamp to zero; worse grade is displayed |
| Stability | Calculated | Loaded-latency spread, spike ratio, worse down/up throughput variation, failed probes/requests, and test completion |
| UDP reachability | Experimental | WebRTC/STUN ICE gathering; not packet loss and never displayed as a percentage |
| Confidence | Calculated | Observable run quality with exact per-factor deductions shown in the UI |
| Health score | Calculated | Seven documented weighted rules plus an explicit unscored packet-loss row from `src/lib/scoring.ts`; the UI renders the same inputs, rules, and points |
| Data transferred | Measured | Live and final application-payload byte counters from the engine; protocol overhead and aborted partial uploads are excluded |
| Test server | Measured metadata | Provider, Cloudflare serving-edge code, client country code, protocol, IP family, probe availability, and HTTPS latency |
| Public IP | Measured metadata | Echoed by Cloudflare, masked by default, never stored in test results or exports in full |
| ISP / ASN / approximate area | Optional estimate | Explicit user-initiated `ipwho.is` lookup; validated response, masked IP, no history/export persistence |
| Black Box latency distribution | Measured/calculated | Repeated real Cloudflare HTTPS round trips; min/median/mean/P95/P99 and consecutive-sample jitter over successful primary probes |
| Black Box reachability | Measured | Successful or failed HTTPS requests per configured endpoint; explicitly not packet loss |
| Black Box controlled DNS | Measured with limitation | Cloudflare DNS-over-HTTPS transaction status and transport-inclusive duration; not the OS resolver |
| Black Box incidents | Calculated | Published deterministic thresholds and grouping rules from real samples; no causal ISP attribution |
| Black Box session quality/confidence | Calculated | Transparent weighted formulas for stable/degraded/interrupted time, latency, jitter, probe coverage, scheduling, visibility, supporting observations, and completion |

## Mocked, random, hard-coded, or unsupported values

- No production result is populated from a fixture, random number, timeout, or
  placeholder.
- Cache-busting uses a monotonic high-resolution token plus a request sequence;
  no random function feeds a measurement or progress value.
- Web Crypto fills upload bodies with non-compressible, non-personal bytes; the
  bytes are traffic, not synthetic result values.
- Configuration constants define sample cadence, time/byte caps, score weights,
  and documented grade thresholds. They do not substitute for measurements.
- Preflight duration/data figures are explicitly estimates and include the
  configured payload ceiling before in-flight overshoot.
- Browser connection type and VPN/proxy status are best-effort hints and are
  labeled as such.
- Packet loss, Wi-Fi signal/SSID, router details, LAN devices, outages, and
  vulnerability scanning are not claimed.

## Accuracy fixes completed in the current engine

1. Replaced the live data-use estimate derived from Mbps with cumulative counted
   application bytes from the engine.
2. Replaced upper-half sample selection with total transferred/submitted payload
   divided by actual phase duration, avoiding upward selection bias.
3. Upload progress now updates from cumulative successfully submitted payload
   after each successful HTTP response; any median, peak, or variation is explicitly labeled as a submitted-payload
   observation rather than byte-level upload telemetry.
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
11. Added discarded transfer warm-ups, bounded adaptive request sizing, warm-up
    outcome disclosure, and warm-up-inclusive application-payload accounting.
12. Added reliable/median/peak-observation/variation fields and explicit phase
    stop reasons; payload-capped short phases now reduce confidence.
13. Stability now includes failed loaded probes, failed throughput requests,
    completion, and visible probe completeness.
14. Health scoring includes run confidence and discloses packet loss as
    unavailable and unscored instead of silently omitting it.
15. Added privacy-safe CSV and diagnostic-report exports and a complete pipeline
    integration test.
16. Replaced the basic in-memory latency monitor with the persistent Connection
    Black Box: explicit monitoring modes, drift-aware scheduling, real latency,
    reachability, controlled DNS and edge observations, lag-event correlation,
    evidence-based incidents, bounded local retention, and raw/support exports.

## Privacy and security

- Public IP is masked by default. Reveal is a deliberate button action.
- Full IP is not placed in test results, history, JSON exports, or logs.
- Automatic diagnostics contact Cloudflare for measurement and trace data.
- The optional IP metadata request is not automatic. The UI names `ipwho.is`,
  explains that it sees the requesting public IP, masks the returned IP, and
  does not persist the response.
- Geist is bundled through `@fontsource-variable/geist`; the application makes
  no Google Fonts request.
- `vercel.json` defines CSP, Permissions Policy, Referrer Policy, MIME-sniffing,
  framing, and HSTS headers. The CSP permits only the documented measurement,
  optional lookup, and font origins.

## Accessibility and layout

The existing racing-inspired cluster, responsive grid, and keyboard-operable
metric buttons are preserved. Metric cards now expose provenance as measured,
calculated, or experimental. The health-score breakdown has a visible report
button in addition to the clickable dial score. Dialogs use the official
shadcn/Radix focus-managed primitive. A richer textual alternative for every raw
chart series remains future work.

## Remaining limitations and next priorities

1. True packet loss requires a cooperating UDP/TURN measurement service.
2. A second independent CORS-capable throughput provider is needed for useful
   multi-provider comparison; fake server candidates must not be added.
3. Browser Fetch cannot expose upload progress or exact on-wire usage.
4. Environmental scenarios such as Wi-Fi versus Ethernet, VPN, mobile, and
   background throttling require manual live runs.
5. Provide downloadable/textual probe-series alternatives for every chart.
6. Repeat controlled live full/low-data runs after deployment and record results
   without treating one connection as universal validation.

## Validation gate

Every implementation stage must pass TypeScript, zero-warning ESLint, Vitest,
and the Vite production build. See [VALIDATION.md](VALIDATION.md) for the current
automated matrix and live-check status.
