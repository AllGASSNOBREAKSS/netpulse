# NetPulse reference-integration audit

Audit date: 2026-07-21. This document was completed before changing production measurement logic for this phase.

## Current native engine

NetPulse is a React/Vite browser application. `src/lib/engine.ts` orchestrates browser-only modules for preflight, endpoint selection, latency, download, upload, experimental UDP reachability, calculations, and confidence. React calls the engine directly and receives callbacks. The selected endpoint comes from a versioned directory; the only checked-in public endpoint is Cloudflare anycast. History is privacy-minimized `localStorage` data.

### Current measurement sources and formulas

| Metric | Source | Current formula | Audit status |
| --- | --- | --- | --- |
| Download | Streamed, cache-busted `fetch` responses | received application payload bits / actual monotonic phase seconds | Real; warm-up discarded, single and multi stream retained |
| Upload | Generated in-memory bodies sent with `fetch` | successful submitted body bits / actual monotonic phase seconds | Real client-side submitted payload; server receipt is not independently acknowledged by the current public endpoint |
| Idle latency | Sequential zero-byte HTTPS requests | median of 14 full or 10 low-data RTTs | Real application RTT; not ICMP |
| Loaded latency | Zero-byte HTTPS probes during each directional load | median of successful probes | Real; download and upload remain separate |
| Jitter | Ordered idle RTT samples | mean absolute consecutive RTT difference | Real calculated value |
| Packet loss | WebRTC ICE/STUN reachability only | no loss percentage | Correctly unavailable; STUN is not loss |
| Bufferbloat | Real idle and loaded medians | max(0, loaded median - idle median), per direction | Real calculated value |
| Stability | Loaded RTT spread/spikes, throughput CoV, failures, completion | documented weighted penalty score | Calculated; needs richer phase evidence |
| Internet health | Throughput, latency, bloat, jitter, stability, confidence | documented weighted score totaling 100 | Calculated and transparent; normative consumer thresholds, not a diagnostic fact |
| Confidence | samples, variation, probes, warm-ups, duration, foreground state, errors | observable penalty model starting at 100 | Calculated; missing endpoint agreement/load, device calibration, retries, and main-thread evidence |

### Accuracy and architecture problems

1. The engine is one sequential promise with coarse UI phases. It has no durable phase journal, typed event stream, first-class cancellation result, or phase-specific retry record.
2. Raw measurement callbacks update React on every sample and copy the live sample array. Rendering should consume a buffered lower-frequency stream instead.
3. Only fixed full and low-data profiles exist. Per-request payload adapts after warm-up, but duration, stream count, timeouts, and total budgets are not calibrated across speed/device/latency tiers.
4. Upload counts a request body after an HTTP success. A NetPulse endpoint should return an authenticated or same-origin accepted-byte receipt before claiming server-accepted bytes.
5. Server ranking uses median, jitter, reachability, route consistency, health, load, and capacity, but does not explicitly penalize P95 tail latency. Only one real public endpoint currently prevents independent verification.
6. Throughput retains mean phase rate, median windows, peak, samples, and CoV, but not P5/P95 in the normalized result.
7. Latency summaries omit P90 and interquartile mean.
8. Raw evidence lacks phase start/end timestamps, per-phase error/retry records, methodology/engine versions, calibration results, and visual/main-thread observations.
9. History stores only normalized headlines and is capped at 50 entries. It cannot recalculate formulas from original evidence or apply robust multi-test alert debounce.
10. IPv4/IPv6 reachability is best effort; throughput and latency are not measured separately per family.
11. Errors are collapsed to a generic UI state. Incomplete results are not published, but the failure reason is not preserved for the user.
12. No public production value was found using `Math.random`, mock data, demo values, or simulated packet loss. `crypto.getRandomValues` is used only to create non-personal incompressible upload payloads.

## Reference repositories

The audit used shallow, read-only snapshots. No source code is copied into NetPulse.

| Repository | Audited commit | License | Useful patterns | Exclusions |
| --- | --- | --- | --- | --- |
| `henrywhitaker3/Speedtest-Tracker` | `8cb2e8a3236850b4a07e887ac376c0d4d5e804f4` | GPL-3.0 | queued tests, provider interface, normalized history, failure events, threshold history | Legacy provider dependency, UI, branding, and Ookla execution are not adopted |
| `sivel/speedtest-cli` | `22210ca35228f0bbcef75a7c14587c4ecb875ab4` | Apache-2.0 | upload preallocation, monotonic timing, bounded concurrency, cancellation, independent single/multi behavior | Its latency is explicitly non-authoritative; Speedtest.net endpoints/protocol and implementation are not adopted |
| `sindresorhus/speed-test` | `200dda1b649eb00864a183912a9720ce2def7ae3` | MIT | event-driven progress separated from terminal rendering, concise final/JSON distinction | It wraps `speedtest-net`; neither dependency nor Ookla service becomes a NetPulse engine |
| `alexjustesen/speedtest-tracker` | `166a84a8f5561059a642d1d5943cc0b8bf667534` | MIT | staged start/select/run/benchmark/complete jobs, explicit statuses, full raw provider data plus normalized fields, schedules, pruning, thresholds | Fake-result generator, provider branding, CLI invocation, and service-specific data are not adopted |

GPL-3.0, Apache-2.0, and MIT concepts can inform an AGPL-3.0-only project. Direct copying would create preservation/notice obligations, so this phase independently implements general architectural ideas and records attribution without importing code.

## Controlled integration plan

| Pattern | Reference | Implementation approach | Why | NetPulse scope |
| --- | --- | --- | --- | --- |
| Durable staged pipeline | Both trackers | Independent typed state machine and phase journal | Prevent incomplete publication and preserve failures/timing | `types.ts`, new pipeline modules, `engine.ts` |
| Typed progress events | `speed-test`, `speedtest-cli` callbacks | Independent event buffer with high-frequency raw retention and throttled subscribers | Decouple React work from measurement timing | new event module, `App.tsx` |
| Cancellation | `speedtest-cli` shutdown event, tracker batch cancellation | `AbortSignal` propagated through every browser operation | Stop timers/fetches without leaking work | engine, latency, throughput, servers, preflight |
| Upload payload reuse | `speedtest-cli` preallocation | Keep one Web Crypto-generated buffer per phase and reuse it | Avoid timed-phase allocation and compression artifacts | `throughput.ts` |
| Rich normalized plus raw evidence | modern tracker | Versioned phase journal, samples, profile/calibration, endpoint probes, limitations | Allow later formula improvements | result types, export, local evidence storage |
| Adaptive profile | `speedtest-cli` dynamic configuration concept | Independent calibration based on warm-up throughput, RTT, device/timer observations, low-data constraint | Avoid one profile for every link | profiles/calibration/engine |
| Endpoint truth verification | nearest-server concepts plus NetPulse directory | Primary plus honest secondary-verification status; no consensus without a second validated endpoint | Detect endpoint constraints without inventing coverage | servers, verification, passport |
| Accuracy Passport | NetPulse-specific | Evidence-derived summary of samples, endpoint health/agreement, device limitations, versions, retries, and reasons | Make trust inspectable | result types, report/export UI |
| Historical debounce | trackers | Median/MAD personal baseline and configurable N-of-M confirmation, locally | Reduce one-run false alarms | history intelligence module |
| Validation adapters | tracker provider interface | Types and disabled-by-default adapter registry only | Support lab comparisons without replacing public results | validation-only adapter module |

## Deferred until infrastructure exists

- A packet-loss percentage needs a reviewed NetPulse echo protocol.
- Multi-server consensus needs a second independently validated endpoint.
- Separate IPv4/IPv6 throughput needs endpoints with explicit family URLs.
- Scheduled browser tests require a user-consented installed application, service worker constraints review, or native companion; a closed webpage cannot promise reliable schedules.
- Public API, webhooks, Prometheus, notifications, accounts, and cross-device retention need authenticated backend product and privacy design.
- Native Chrome/Edge/Firefox/Safari, mobile, Wi-Fi, VPN, and regional validation remain controlled-lab or field work, not browser-source changes.

## Implemented outcome

The audit findings were addressed with an independently implemented v3 browser pipeline:

- `measurementPipeline.ts` provides the typed event stream, terminal states, durable phase journal, retry records, and 100 ms presentation batches.
- `AbortSignal` reaches preflight, discovery/probing, latency, throughput, trace, and the WebRTC reachability probe. Cancelled or failed runs are not published.
- Warm-up throughput calibrates request size and stream count within profile caps. Quick diagnostics now resolve to their own profile instead of silently using low-data settings.
- Normalized throughput includes P5/P95 and actual stream/calibration data; latency includes P90 and interquartile mean.
- `clientCalibration.ts` records timer, foreground, worker, processor, and payload-generation observations without inventing device capacity.
- The Accuracy Passport exposes endpoint health/load, secondary-verification status, sample/failure counts, streams, data, duration, versions, retries, limitations, and confidence reductions.
- Complete privacy-filtered raw events and phase journals are kept locally for the latest 20 successful runs in IndexedDB; compact history remains backward-compatible.
- React speed-test and guided-diagnostic views consume buffered event batches rather than updating for every raw measurement callback.
- Historical intelligence uses a median/MAD baseline and an explicit N-of-M confirmation rule; validation adapters are disabled by default and cannot enter public results.

Still deferred: server-acknowledged upload byte receipts, true browser packet loss, a second independently validated throughput endpoint, separate IPv4/IPv6 throughput, reliable closed-page scheduling, and native cross-platform evidence.
