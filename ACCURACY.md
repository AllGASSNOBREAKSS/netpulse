# NetPulse accuracy and trust model

NetPulse reports what its browser engine observed; it does not promise parity with another speed-test provider or claim worldwide accuracy without controlled evidence. The implemented formulas are specified in [METHODOLOGY.md](METHODOLOGY.md), and executed or blocked validation is recorded in [VALIDATION_REPORT.md](VALIDATION_REPORT.md).

## What is directly observed

- Download application bytes delivered to JavaScript and monotonic phase time.
- Upload application payload associated with successful HTTP POST responses and monotonic phase time. This is **successfully submitted payload**, not a cryptographic receipt of server-received bytes.
- Sequential HTTPS request timings for idle, download-loaded, and upload-loaded latency.
- Family-specific IPv4/IPv6 HTTPS timings and browser/server transport facts when explicitly exposed.
- Per-window download throughput, cumulative upload observations, failures, stop reasons, stream counts, phase timings, tab visibility, client-calibration facts, and endpoint probes.
- Documented endpoint metadata and privacy-filtered trace fields when the source returns them.

Unavailable values are omitted or labeled unavailable. In particular, the current public engine does not report a packet-loss percentage, exact location, Wi-Fi signal, router telemetry, or a silently substituted third-party measurement.

## Derived results

- Headline download and upload are counted application bits divided by actual measured phase time.
- Consumer latency is the median of successful samples; minimum, mean, interquartile mean, P90, P95, P99, standard deviation, failures, and count remain available as evidence.
- Jitter is the mean absolute difference between consecutive successful latency samples.
- Directional bufferbloat is `max(0, loaded median - idle median)` for download and upload separately.
- Stability and Internet Health are transparent product calculations with their factors and weights exposed; neither is a standardized network metric.
- Historical comparison uses a personal median and median absolute deviation after enough local history, then requires three of the latest five degraded results before confirming an alert. ISP comparison requires at least three locally recorded tests under the exact same ISP label.

## Confidence and the Accuracy Passport

Confidence starts at 100, subtracts only evidence-backed penalties, and is clamped to 0–100. Current factors include download/upload sample count and variation, idle and loaded-latency sample counts, endpoint reachability/jitter/health/load, warm-up and minimum-duration completion, tab visibility, request/probe errors, backup availability, and client-calibration warnings. Every applied deduction is returned as a visible reason.

Each completed result receives an Accuracy Passport containing its run ID, engine and methodology versions, sample and failure counts, endpoint selection, backup verification status, endpoint health/load, stream counts, transferred data, duration, IP-family comparison, transport telemetry, browser state, phase retries, limitations, and confidence reasons. A bounded secondary download records agreement or disagreement but never replaces or averages the primary result.

## Current evidence boundary

The source suite validates formulas, state transitions, cancellation, endpoint ranking, privacy behavior, and controlled-result ingestion. This machine could not execute the Docker/netem/iperf3 matrix because its Docker engine is unavailable. Therefore no speed tier, browser family, native platform, or geographic region has passed the controlled accuracy gate in this session.

Until the lab matrix is executed, NetPulse must not claim calibrated multi-gigabit accuracy, authoritative packet loss, validated regional coverage, or universal equivalence to Ookla, FAST.com, Cloudflare, M-Lab, or iperf3. Proposed tolerances in [METHODOLOGY.md](METHODOLOGY.md) are launch gates, not achieved results.

## Reproducibility and retention

The latest 20 complete privacy-filtered evidence records are stored only in local IndexedDB; normalized history remains local and is linked by run ID. JSON/CSV exports omit unavailable metrics and never include a full public IP. Lab result files are ignored by Git. Clearing or deleting history also clears linked raw evidence.

## Known browser limits

Fetch does not expose upload byte progress, retransmissions, congestion-control state, or link-layer bytes. Background tabs can throttle timers and networking. Browser/device processing, endpoint capacity, routing, VPNs, radio conditions, and connection reuse can affect results. A browser cannot reliably access Wi-Fi signal, router state, LAN devices, BGP routes, or raw UDP sockets. These constraints are recorded or disclosed rather than inferred away.
