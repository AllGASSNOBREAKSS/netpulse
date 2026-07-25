# Connection Black Box methodology

Connection Black Box is NetPulse's local-first, low-data monitor for finding
intermittent latency, reachability, DNS-path, endpoint, and browser-scheduling
events. It is an observability tool, not an outage oracle: every result is tied
to a real browser observation, and unavailable evidence stays unavailable.

## Monitoring modes and data budget

| Mode | Duration | HTTPS cadence | Controlled DNS cadence | Endpoint observation cadence |
| --- | ---: | ---: | ---: | ---: |
| Quick scan | 5 minutes | 2 seconds | 30 seconds | 60 seconds |
| Gaming | 30 minutes | 1 second | 30 seconds | 60 seconds |
| Video call | 1 hour | 2 seconds | 45 seconds | 90 seconds |
| Work session | 2 hours | 5 seconds | 90 seconds | 3 minutes |
| Evening congestion | 4 hours | 10 seconds | 2 minutes | 5 minutes |
| Custom | 5–480 minutes | selected from duration | selected from duration | selected from duration |

The setup screen shows an estimated application-response payload before a run.
The estimate uses 16 bytes per zero-body latency probe, 1,200 bytes per DNS
response, and 900 bytes per endpoint observation. The final counter is the
actual response-body payload JavaScript received. Neither value includes HTTP,
TLS, IP, or radio overhead.

## Real telemetry sources

- **Primary latency and reachability:** cache-busted, no-store, zero-byte HTTPS
  requests to Cloudflare's public speed endpoint, timed with
  `performance.now()`. A successful HTTP response is reachable; a timeout,
  network error, or non-success status is a failed endpoint probe.
- **Secondary reachability:** an optional independent HTTPS URL supplied as
  `VITE_MONITOR_SECONDARY_URL`. NetPulse ships without one, so this evidence is
  visibly unavailable by default.
- **Controlled DNS:** an uncached `A` query for `example.com` using Cloudflare
  DNS over HTTPS. Duration includes HTTPS transport and is not an isolated
  measurement of the operating system's configured resolver.
- **Endpoint observations:** Cloudflare trace and explicit IPv4/IPv6 trace
  requests. NetPulse retains only the serving edge code and observed IP family;
  it does not retain the echoed public IP.
- **Browser context:** planned time, actual start time, scheduling delay, and
  page visibility for each probe, plus visibility transitions. These separate
  browser throttling or sleep gaps from observed network failures.

Each request has a five-second timeout and supports cancellation. The scheduler
uses monotonic target times instead of chaining completion delays. If a tick is
very late it records that delay and advances to the next future target instead
of issuing a misleading burst of catch-up probes.

## Statistics and state

Only successful primary-endpoint round trips enter latency statistics:

- minimum, median, and arithmetic mean;
- P95 and P99 using linearly interpolated percentiles;
- jitter as the mean absolute difference between consecutive successful
  latency samples.

The session baseline is the median. A successful sample is **degraded** when
its latency is at least `max(100 ms, 3 × baseline, baseline + 100 ms)` or its
browser scheduling delay exceeds `max(750 ms, 1.5 × probe interval)`.
Successful samples below both thresholds are **stable**. Failed primary HTTPS
probes are **interrupted**. These percentages classify observed probe periods;
they are not packet-loss percentages or guarantees about every destination.

Best and worst periods are 30-second windows with at least two successful
samples, ranked by median latency.

## Incidents

Incident detection is deterministic:

- **Latency spike:** a sample crosses the adaptive degraded-latency threshold.
- **Severe jitter:** the absolute change from the preceding successful sample
  is at least `max(50 ms, 2 × baseline)`.
- **Primary interruption:** one or more primary HTTPS probes fail.
- **Controlled DNS failure:** the DNS-over-HTTPS request fails, is malformed,
  or returns a non-zero DNS response code.
- **Endpoint-specific failure:** a configured primary or secondary endpoint
  fails while the other succeeds.
- **Browser scheduling suspension:** one or more probes start beyond the
  scheduling-delay threshold.

Upload-related degradation and download-related degradation are shown as
**insufficient evidence** in this lightweight monitor. It neither generates nor
observes sustained directional traffic, so assigning either label would be
fabricated. The full Speed Test measures download-loaded and upload-loaded
latency separately.

Adjacent selected samples remain one incident unless their planned times are
more than 2.5 probe intervals apart. A probe incident lasts at least one probe
interval. Severity comes from published duration, count, and peak-latency
bands. Confidence is based on foreground and on-time coverage plus incident
sample count; it does not claim root cause. Network ownership is never inferred.

The **I Felt Lag** control stores a local timestamp and optional note. NetPulse
correlates incidents in the 15 seconds before and after it. If none overlap,
the report says exactly: "No measurable network anomaly was detected around
this event." This does not imply that the user's experience was unreal; it
means the available browser telemetry did not observe a matching symptom.

## Quality and confidence

Session quality is a transparent 0–100 weighted calculation:

| Component | Weight |
| --- | ---: |
| Stable-sample percentage | 35 |
| P95 latency quality (full at ≤40 ms, zero at ≥400 ms, linear between) | 20 |
| Jitter quality (`1 - jitter / 50`, clamped) | 15 |
| Interruption quality (`1 - interruption percentage / 10`, clamped) | 15 |
| Session confidence | 15 |

Labels are Excellent (90+), Good (75+), Degraded (55+), and Poor (below 55).

Confidence is separate and shows every factor: probe completeness 35%, browser
scheduling 25%, foreground coverage 15%, controlled-DNS coverage 10%, and
session completion 15%. A completed run earns full completion credit; a
user-stopped run earns 75%, a running/paused run 60%, and a refresh-interrupted
run 35%. Confidence describes evidence quality, not connection quality.

## Local storage, retention, and recovery

Sessions stay in browser `localStorage` and are never uploaded by NetPulse.
Retention can be 1, 7, 30, or 90 days. Storage is bounded to the latest ten
sessions, 5,000 latency samples, 600 DNS/endpoint/visibility observations, and
100 lag markers per session. Malformed or future-schema data is rejected.
Quota or privacy-mode storage failures are shown to the user rather than hidden.
A running or paused session recovered after reload is marked interrupted while
preserving its recorded evidence; background tabs and device sleep cannot be
promised uninterrupted execution by a browser.

## Reports and privacy

- **Full JSON** contains the session method, raw samples, observations, markers,
  calculations, incidents, limitations, and optional opted-in identity.
- **Raw CSV** contains scheduled/start/completion time, scheduling delay,
  visibility, primary/secondary status and timing, and response bytes.
- **Support report JSON** is compact PDF-ready source data; a text version is
  also available.
- **Safe share link** stores only a bounded summary in the URL fragment, carries
  a client-enforced seven-day expiry, and
  excludes raw samples, public IP, exact location, SSID, device names, and
  payload contents.

ISP, ASN, and approximate region are unavailable until the user explicitly
requests an `ipwho.is` lookup. The UI explains that the provider will see the
requester's public IP. Only provider name, ASN, and approximate region are kept;
full IP is not stored. IP-based location is approximate.

## Browser and infrastructure limitations

- True end-to-end packet loss is unavailable without a cooperating UDP echo or
  TURN measurement service. Failed HTTPS probes are reachability failures, not
  a loss percentage.
- NetPulse has one default public measurement provider. Without an independent
  secondary endpoint, a failure cannot prove a general internet outage or
  isolate a route.
- Persistent WebSocket/WebTransport echo telemetry is unavailable because no
  NetPulse echo service is deployed.
- Lightweight probes do not load the connection, so they cannot attribute an
  event to upload or download traffic.
- A browser cannot read Wi-Fi signal/channel, router state, LAN device lists,
  or ISP infrastructure. The monitor never invents those values.
- Background throttling, CPU contention, power saving, sleep, captive portals,
  VPNs, proxies, extensions, and endpoint/CDN conditions can influence results.
  Visibility and scheduler evidence are retained so those limitations remain
  visible.

To enable a vetted secondary endpoint, set `VITE_MONITOR_SECONDARY_URL` to an
HTTPS endpoint that allows browser CORS requests and returns a small response,
then add only that exact origin to `connect-src` in `vercel.json`. Do not use a
URL containing credentials or private infrastructure identifiers.
