# NetPulse accuracy and performance validation report

## Technical summary

**Recommended public-launch status: not validated for a global accuracy claim.** The repository now contains a repeatable, privacy-minimized controlled lab, statistical launch gates, browser performance instrumentation, and a source-backed internal dashboard. On this host, Docker Desktop's daemon is not running and host `iperf3`/Linux `tc` are unavailable. No controlled speed, latency, browser, device, or regional matrix was executed in this phase. Every requested accuracy cut is therefore **not measured**, not zero and not passed.

Local source validation can establish that lab configuration, parsers, calculations, tests, and the production bundle are structurally sound. It cannot prove measurement accuracy. NetPulse should not be marketed as a validated global measurement platform until the matrix runs on capable hardware and native platforms, failures are retained, and every required segment passes.

## Evidence produced

- A two-network Docker topology with HTTP endpoint, iperf3 server, UDP echo, bidirectional `netem` shaper, routed TCP/UDP baselines, and pinned Playwright runners.
- Profiles for 1 Mbps through 5 Gbps, 5-300 ms RTT, jitter, random loss, queue depth, background saturation, endpoint failure, intermittent outage, and mid-run path-quality change.
- One privacy-minimized schema per run with strict validation, duplicate rejection, and direct-IP/exact-location rejection.
- Absolute-error, P95, variation, failure, data-use, duration, and confidence-calibration calculations with tier-specific gates.
- A development-only dashboard for error by speed/browser/region/endpoint, variation, completion/failures, confidence, packet-loss validity, data use, endpoint health, browser impact, source freshness, and rejected evidence.
- A real stable-result timestamp emitted when the throughput early-stop criterion is met.

## Local implementation validation

- `npm run check`: type checking passed; ESLint passed with zero warnings; 26 test files / 147 tests passed; the production Vite build passed.
- Lab JavaScript and PowerShell parsing passed, and `docker compose config --quiet` accepted the topology.
- The development-only dashboard rendered at 1440 x 900 and 390 x 844 with no horizontal overflow, an honest empty state, and a visible keyboard focus ring on its file control.
- The application shell was rechecked in the local browser at desktop (1280 px), tablet (768 px), and mobile (375 px actual viewport) widths with no horizontal overflow. Speed Test started and cancelled cleanly, cancellation cleared partial gauge values, navigation opened Connection Black Box and returned to Speed Test, dark/light theme switching persisted across navigation, and the focused theme control had a visible focus indicator. No application console errors occurred; the only warning was Lit's expected development-mode notice from Vite.
- Docker image builds and controlled runs did not execute because this host has Docker CLI 29.5.2 but no reachable Docker engine. Host `iperf3` and Linux `tc` are also unavailable.
- The production build still reports an existing large main-chunk warning (approximately 819 kB minified / 258 kB gzip); the validation dashboard remains development-only and is not reachable in production mode.

## Controlled conditions tested

| Condition | Requested coverage | Executed here | Result |
| --- | --- | --- | --- |
| Download tiers | 1, 5, 10, 25, 50, 100, 500 Mbps; 1, 2.5, 5 Gbps | No | Not measured; Docker daemon unavailable |
| RTT | 5, 20, 50, 100, 200, 300 ms | No | Not measured |
| Jitter / random loss | Profile-controlled | No | Not measured |
| Upload/download saturation | iperf3 background traffic | No | Not measured |
| Bufferbloat | ping and HTTPS RTT under directional load | No | Not measured |
| Asymmetric links | Independent down/up rate controls | No | Not measured |
| Endpoint failure/outage | stop and timed pause/unpause | No | Not measured |
| Route change | Mid-run path-quality change only | No | True BGP/route change not implemented |

## Accuracy by speed tier

No tier has controlled runs. The dashboard requires at least ten retained attempts per segment. Proposed throughput gates are 10% median/20% P95 absolute error through 100 Mbps, 12%/25% through 1 Gbps, and 15%/30% above 1 Gbps. Multi-gigabit tiers additionally require verified NIC, switch, host, browser, bridge, and endpoint headroom.

## Accuracy by browser and platform

No controlled browser result was executed. The container lab can cover Chromium, Firefox, and WebKit on Linux, but these are not native Chrome, Edge, or Safari certifications. Windows, macOS, Linux, Android, iOS, Wi-Fi, Ethernet, mobile, VPN, IPv4/IPv6, foreground/background, battery saver, high CPU, and low/high-performance hardware remain required field segments.

## Accuracy by region and endpoint

No geographic validation ran. `controlled-local` is not worldwide coverage. The public directory still has only the real Cloudflare anycast fallback; proposed NetPulse-operated regions remain planned. Regional accuracy needs independently capacity-tested endpoints and real clients in every claimed geography.

## Statistical definitions and gates

- Throughput error: absolute percent difference between NetPulse and the same-condition iperf3 receiver result.
- Latency error: absolute difference between NetPulse HTTPS idle median and the routed baseline median, with protocol overhead interpreted separately.
- Test variation: coefficient of variation across completed headline results.
- Failure rate: failed/aborted attempts divided by all retained attempts.
- Confidence calibration: Brier score comparing reported confidence with whether the run met core tolerances.
- Time to stable: actual elapsed phase time when the measured stable-window rule fires; null if it never fires.
- Data transferred: application payload reported by the engine, excluding protocol/link overhead.

Ten repetitions are a minimum gate, not a guarantee of power. Variable segments need more runs and confidence intervals. Jitter and bufferbloat tolerances must be finalized against observed baselines because a configured `netem` parameter is not observed RTT jitter.

## Failure cases and production safety

The lab retains failures and controls endpoint stop, intermittent pause, saturation, loss, and path-quality changes. These cases remain unexecuted here. Live validation is still required for endpoint failover, regional health removal, rate limits, upload ceilings under concurrency, mobile usability, raw-export correctness, and confidence under real failures.

No fake production values were added. Lab HTTP and the in-page result hook require Vite development mode plus `VITE_NETPULSE_LAB_MODE=true`. Lab output rejects raw IP, coordinates, exact location, street address, and email. Result files are ignored by Git.

## Performance bottlenecks to measure

- Endpoint payload copying and Docker bridge throughput above 1 Gbps.
- Browser stream consumption and garbage collection at large payloads.
- Main-thread chart/render work versus the same engine run without UI.
- Upload body allocation and missing browser upload-progress events.
- Background-tab/battery timer throttling.
- `netem` rate bursts and TCP Small Queues effects.
- Endpoint/NIC saturation being misclassified as user-link limits.

The runner records long-task count/time, maximum frame delay, heap where implemented, and reasons for unavailable CPU/memory fields. A matched engine-only/full-UI comparison remains necessary before quantifying UI bias.

The optional portable-HTML packaging attempt was blocked by horizontal overflow in the shared report reader at a 1440 px verification viewport, including after one chart simplification. The failed HTML is not a deliverable; this Markdown report is the review source until that shared-renderer defect is resolved.

## Remaining limitations and robustness work

1. Start Docker Desktop and execute the smoke matrix.
2. Run at least ten repetitions for every core tier/RTT/impairment/browser segment and retain failures.
3. Add an engine-only harness and matched full-UI comparison.
4. Add true two-gateway route-change scenarios; current control changes path quality, not BGP state.
5. Deploy and validate the reviewed WebSocket echo protocol in a real pilot region. WebSocket message delivery is useful application evidence, but TCP retransmission still prevents it from becoming an end-to-end packet-loss percentage.
6. Build native Chrome/Edge/Firefox/Safari and Android/iOS runners.
7. Validate Wi-Fi, Ethernet, VPN, IPv4, IPv6, mobile, background, battery-saver, and high-CPU conditions.
8. Deploy and independently capacity-test one pilot region before claiming regional coverage.
9. Use competitor comparisons as explanatory diagnostics only.

## Safe production limits

Until controlled evidence exists, keep current full/low-data duration, stream, and byte ceilings; keep packet loss unavailable; keep IP masked; keep exact location absent; and keep proposed regions planned. Do not use multi-gigabit marketing, global accuracy language, or endpoint-capacity claims. The isolated lab endpoint is not a public service.

## Recommended next decision

Review the lab design, then run the three-tier Chromium smoke matrix on a Docker-enabled host. If endpoint, shaper, and baselines are internally consistent, proceed through 1 Gbps. Treat 2.5/5 Gbps, native browsers/devices, and regional pilots as separate hardware and field gates.

## Current multi-region foundation runtime check

On 2026-07-21 a real low-data browser run completed locally against the only active public candidate, Cloudflare anycast edge EWR. It measured 6.2 Mbps download, 19.0 Mbps upload, 65 ms idle latency, 67 ms download-loaded latency, 320 ms upload-loaded latency, 14.1 ms jitter, and 17.2 MB of application payload in 21.7 seconds. The values describe this one run and are not accuracy validation.

- The endpoint selector exposed automatic selection and the one real endpoint only. It reported zero supported/pilot requested regions, 15 planned or unsupported regions, no independent backup, and unavailable health/load/capacity/version telemetry.
- The Accuracy Passport displayed engine/methodology versions, sample count, stream count, payload, endpoint, secondary-verification status, family-specific probe status, browser protocol, and server telemetry availability. Generic `Server-Timing` is not described as TCP/QUIC RTT or retransmit evidence.
- WebSocket echo was not advertised by the public fallback, so NetPulse kept packet loss unavailable and displayed only the experimental STUN UDP-reachability limitation.
- History persisted the completed run locally; exact public IP was masked in the result and absent from exports/evidence. An ISP comparison did not appear because no real ISP identity was available.
- The application rendered without document-level horizontal overflow at 390 x 844, 768 x 1024, and 1440 x 900. Dark and light themes rendered, keyboard focus had a visible 3 px focus ring, navigation and footer worked, and the browser console contained no warnings or errors.

This check validates orchestration and honest presentation. It does not validate the 15-region data plane, IPv6 availability, server-side TCP/QUIC telemetry, cross-server agreement, true packet loss, or controlled accuracy.
