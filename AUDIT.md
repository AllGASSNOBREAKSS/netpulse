# NetPulse — Technical & Product Audit

**Date:** 2026-07-19 · **Scope:** full codebase, measurement logic, UI, state, storage, security, accessibility · **Phase:** stabilization (pre-feature-work)

---

## 1. Current architecture

```
index.html                     app shell, fonts (Space Grotesk, JetBrains Mono, Exo 2)
src/main.tsx                   React 18 entry
src/App.tsx                    shell: collapsible sidebar, views, test orchestration, history
src/components/
  Speedometer.tsx              270° SVG dial, spring-physics needle, rAF + watchdog
  Panels.tsx                   LatencyMonitor · ConnectionPrivacy · Devices
  Modal.tsx                    accessible modal shell (Escape, backdrop, aria-modal)
  MetricDetail.tsx             per-metric explainer + score-breakdown panel
src/lib/
  engine.ts                    measurement engine (all network I/O lives here)
  metrics.ts                   metric definitions: meaning, method, ranges, actions, samples
  scoring.ts                   health-score formula (single source of truth)
  verdict.ts                   headline, activity grades, diagnosis, next actions
src/styles.css                 design system (dark console, automotive cluster)
```

- **No backend, no router, no state library.** Views are local component state; test results flow engine → App → cards/verdict. This is appropriate at the current size.
- **Dependencies:** `react`, `react-dom` only (plus Vite/TS dev tooling). Nothing removable.
- **Persistence:** `localStorage` — test history (`netpulse_history`, capped at 50, try/catch-guarded) and sidebar state (`netpulse_sidebar`). Nothing leaves the device.

## 2. Measurement sources (what is real, and how)

| Metric | Source |
| --- | --- |
| Download speed | Parallel `GET speed.cloudflare.com/__down?bytes=N` streams, bytes counted from `ReadableStream` readers, 250 ms sampling, median of top-half samples |
| Upload speed | Parallel `POST /__up` with counted bodies, same sampling/aggregation |
| Idle latency / jitter | 10 timed zero-byte requests pre-load; median / mean absolute delta |
| Download/upload-loaded latency | Zero-byte probes every ~600 ms *during* saturation; medians |
| Bufferbloat | Derived: worst loaded median − idle median, graded A–F |
| Stability | Derived: loaded probes above max(3× idle, idle+150 ms) |
| Test duration | `performance.now()` wall clock |
| Data transferred | Byte-exact counters from the streams |
| Connection & Privacy panel | `speed.cloudflare.com/cdn-cgi/trace` (live echo of the user's own request) |
| Latency monitor | Real 500 ms probes while running |
| **Packet loss** | **Not measured — displayed as `n/a` with an honest explanation** (browsers cannot send UDP/ICMP; TCP hides retransmits) |

**Conclusion of the mock-data sweep:** no `Math.random`, no fabricated metrics, no hard-coded results anywhere in the measurement path. The inaccuracies found were presentation-level (below).

## 3. Inaccurate or misleading presentation found → fixed

| # | Finding | Fix |
| --- | --- | --- |
| 1 | Gear indicator hard-coded `D3`/`U2` even in low-data mode, which actually runs 1 stream | Stream counts now come from the engine's exported `PROFILES`; UI cannot drift from reality |
| 2 | "Loaded ping" card silently displayed `max(down-loaded, up-loaded)` — two distinct measurements merged without saying so | Split into **Download-loaded latency** and **Upload-loaded latency** cards, each with its own probes and "+N ms vs idle" |
| 3 | Health score was an unexplained number; formula scattered in `verdict.ts` | Formula moved to documented `src/lib/scoring.ts`; clicking the score opens a breakdown showing every component, its measured input, rule, and earned/possible points |
| 4 | Panel titled "Exposure & vulnerabilities" framed neutral facts (TLS version, HTTP version, edge location) as security problems | Renamed **Connection & Privacy**; copy states these are normal properties of every connection, not vulnerabilities |
| 5 | Full public IP rendered by default (screenshot/screen-share leak) | Masked by default (`68.197.•••.•••`, IPv6 handled); explicit reveal/mask toggle; no export/share feature exists, so the masked-by-default rule currently covers all surfaces |
| 6 | Footer claimed "every number on the dial is measured, never simulated" — true of the dial but overbroad as worded | Replaced with a precise claim naming what is measured, stating packet loss is not shown, and noting server/device dependence |
| 7 | Fuel bar scaled against a hard-coded 400 MB regardless of mode | Scales to the active mode's typical footprint |
| 8 | Duration measured but never shown; stability only surfaced indirectly | Both are first-class cards now |
| 9 | (Found during verification) New duration copy itself claimed low-data ≈ 12 s; on fast connections byte caps end phases in ~4 s | Band corrected; duration card now also warns when a short low-data run means loaded-latency figures rest on few probes |

## 4. Dead code / duplicates / broken routes → result

- Removed unused `soon?: boolean` field on the nav type and the unnecessary `dialMax` export.
- `Scope.tsx` (old oscilloscope) was already deleted in the previous redesign; no orphan imports remain.
- No duplicate components (Stat vs Metric serve different panels intentionally). No router exists, hence no broken routes; all five views render.
- TypeScript strict passes; production build clean; zero console errors/warnings at runtime.

## 5. Memory-leak review

- Speedometer: rAF loop and watchdog interval both cleaned up on unmount; state updates gated when the needle is at rest.
- LatencyMonitor: probe loop exits via cancellation flag on unmount/stop; probe buffer bounded at 120 entries.
- **Fixed:** ConnectionPrivacy's trace fetch could set state after unmount — now guarded with a cancellation flag.
- Modal: key listener removed on close.

## 6. Security review

- Static site; no backend, cookies, analytics, or third-party scripts.
- External requests: `speed.cloudflare.com` (measurements + trace) and Google Fonts (CSS/woff2). Neither receives user data beyond the requests themselves.
- `localStorage` holds only test numbers — no PII beyond what the user's own results imply.
- Public IP masked by default (see §3.5).
- **Open items:** no CSP/security headers on the deployment (static host defaults); Google Fonts means a third-party sees visitor IPs — self-hosting fonts is the recommended fix. Both listed in §9.

## 7. Performance review

- Bundle: 189 KB JS (61 KB gzip), 17.6 KB CSS — fine for the category.
- Needle animation only touches React state while moving; background-tab rAF suspension handled by watchdog snap.
- A full test intentionally saturates the line (~100–400 MB); low-data mode (~35 MB) exists and its trade-off is now disclosed on the duration/data cards.
- Fonts load render-blocking from Google CDN (see §9).

## 8. Accessibility review

- Metric cards are real `<button>`s — keyboard focusable, visible focus rings.
- Modal: `role="dialog"`, `aria-modal`, Escape + backdrop close, focus moved on open. **Limitation:** no full focus trap.
- Status line is `role="status"`; dial SVG is `aria-hidden` while the numeral/gear/score are live HTML text.
- Muted-text contrast raised; `prefers-reduced-motion` honored.
- Sample strips and the latency strip are visual-only (`aria-label`/`aria-hidden` provided; no table alternative yet).

## 9. Remaining limitations & recommended next steps

**Known limitations (disclosed in-app where relevant):**
1. Packet loss not measurable in-browser — needs a UDP/WebRTC echo service.
2. Single test endpoint (Cloudflare) — results reflect the path to the nearest CF edge.
3. Low-data mode on fast links yields few loaded-latency probes (now disclosed on the cards).
4. History schema is unversioned; old entries lack newer fields (UI tolerates this).
5. Modal lacks a focus trap; latency strip has no non-visual data view.

**Recommended next steps, in order:**
1. Self-host the three font families (removes the only third-party request; faster first paint).
2. Add security headers (CSP, `X-Content-Type-Options`, `Referrer-Policy`) via `vercel.json`, and connect the GitHub repo to Vercel for push-to-deploy.
3. Focus trap in Modal; text alternative for sample strips.
4. Version the history schema (`{v: 1, entries: []}`) before adding fields.
5. Then feature work: Truth Mode (multi-endpoint), packet loss via a measurement server, Connection Black Box, ISP Proof Pack.

## 10. Verification performed

- `tsc --noEmit` and production build: clean.
- Live low-data test on a real connection: 239↓ / 32↑ Mbps, 40 ms idle, C bufferbloat (+80 ms), score 79 — breakdown panel components sum exactly to the displayed score.
- Interactions exercised in-browser: all 11 metric modals (sections: meaning, method, result, ranges, why, raw samples, action), packet-loss unavailability panel, score breakdown, sidebar collapse/expand (232 px ↔ 64 px), IP mask/reveal/re-mask, Escape/backdrop close.
- Responsive: 375 px (no horizontal scroll, stacked nav, 2-col grid), 768 px (4-col grid), desktop — verified via computed layout.
