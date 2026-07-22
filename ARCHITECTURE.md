# NetPulse measurement architecture

NetPulse keeps the native browser measurement engine independent from React, animation, history, validation providers, and any future regional infrastructure. [ENGINE.md](ENGINE.md) describes the current implementation in detail; this document records the system boundaries and data flow.

## Runtime flow

1. `src/lib/engine.ts` creates a versioned run and an `AbortController`-compatible execution context.
2. `src/lib/measurementPipeline.ts` journals typed phases, attempts, timestamps, terminal states, errors, and raw events.
3. Client calibration and preflight record browser-visible constraints without inventing capabilities.
4. `src/lib/globalNetwork.ts` validates the endpoint directory; `src/lib/servers.ts` probes and ranks compatible candidates and retains backups.
5. `src/lib/latency.ts` and `src/lib/throughput.ts` perform monotonic measurements. Loaded-latency probes run only while their corresponding directional load is active.
6. `src/lib/confidence.ts`, grading/scoring modules, and `src/lib/accuracyPassport.ts` derive explainable results after measurement phases finish.
7. The recorder keeps raw events synchronously and sends buffered UI batches at most every 100 ms. React and gauge/chart animation never schedule network measurement.
8. Completed or explicitly low-confidence results can enter local history and privacy-filtered raw evidence. Failed and cancelled runs are not published.

## State and cancellation

The phase journal covers created, preflight, discovery, probing, selection, idle latency, download/upload warm-ups and measurements, directional loaded latency, packet-loss availability, stability analysis, abnormal-result verification, confidence calculation, and terminal completed/low-confidence/failed/cancelled states.

Each phase has an attempt number, wall-clock and monotonic-relative timestamps, sample boundaries, duration, status, and sanitized error. Phase-specific retry is explicit in the event stream. A shared `AbortSignal` is propagated through endpoint discovery, probing, latency, throughput, trace, and the experimental UDP-reachability check. Cancellation discards partial headline values and closes in-flight work where browser APIs permit.

## Measurement and presentation isolation

Raw byte/sample accounting is performed inside the engine. The UI subscribes to typed event batches and uses presentation-only interpolation. It does not generate values or feed animation state back into formulas. The download needle, arc, ticks, chart, and value share the same measured presentation value; upload uses the same pattern. Reduced-motion changes interpolation, never the underlying result.

## Endpoint and provider boundaries

The checked-in endpoint directory is versioned, schema-validated, and honest about capabilities. The current active public entry is a Cloudflare anycast fallback with no NetPulse health, capacity, version, or echo telemetry. Proposed NetPulse regions remain planned.

`src/lib/validationAdapters.ts` is an internal registry. The native, echo, regional, iperf3, optional Ookla CLI, and optional M-Lab adapters are disabled by default and ineligible to silently replace a public result. Missing infrastructure or separately accepted third-party tooling remains unavailable.

## Persistence and privacy

- Public IP is masked before application state, history, export, or report generation.
- Complete privacy-filtered evidence is local IndexedDB data capped at 20 runs.
- Compact history is localStorage data linked by run ID.
- No exact coordinates or street-level location are retained.
- Exports omit unavailable fields and shared outputs exclude a complete public IP.

## Validation laboratory

The isolated lab under `lab/` defines containerized endpoints, traffic shaping, iperf3 baselines, profiles, fault controls, and result ingestion. Its development-only dashboard is gated from production. Results are accepted only through the controlled schema and cannot become public measurements. Docker/netem execution and real platform/region certification remain external validation work.

## Extension rules

New measurements must declare a real source, formula, raw evidence, sample and failure counts, browser limitations, privacy treatment, cancellation behavior, confidence impact, and tests. A value that cannot meet that contract must remain unavailable or experimental. New regional endpoints must implement the reviewed contract in [GLOBAL_ENDPOINTS.md](GLOBAL_ENDPOINTS.md) and pass independent capacity and accuracy gates before activation.
