# NetPulse measurement architecture

NetPulse keeps the native browser measurement engine independent from React, animation, history, validation providers, and any future regional infrastructure. [ENGINE.md](ENGINE.md) describes the current implementation in detail; this document records the system boundaries and data flow.

## Architecture status

This repository currently contains two different maturity levels:

- **Implemented locally:** versioned orchestration, phase evidence, cancellation,
  endpoint-directory validation, a capacity Web Worker, adaptive request ramps,
  request diagnostics, privacy-filtered local evidence, scoring, and the
  Accuracy Passport.
- **Designed but not deployed:** NetPulse-operated regional nodes, signed
  high-volume sessions, authoritative upload receipts, unreliable echo,
  independent health/capacity telemetry, provider-diverse verification, and
  global operational aggregation.

The only active public data-plane entry is Cloudflare anycast. The web
application and endpoint manifest can be served by Vercel, but measurement
payloads go directly from the browser to the selected data-plane origin. Vercel
is not a throughput proxy.

The normative browser contract is [NETPULSE_MEASUREMENT_SPEC.md](NETPULSE_MEASUREMENT_SPEC.md).
The future node and selection contracts are
[TEST_NODE_PROTOCOL.md](TEST_NODE_PROTOCOL.md) and
[SERVER_DISCOVERY_SPEC.md](SERVER_DISCOVERY_SPEC.md).

## Runtime flow

1. `src/lib/engine.ts` creates a versioned run and an `AbortController`-compatible execution context.
2. `src/lib/measurementPipeline.ts` journals typed phases, attempts, timestamps, terminal states, errors, and raw events.
3. Client calibration and preflight record browser-visible constraints without inventing capabilities.
4. `src/lib/globalNetwork.ts` validates the endpoint directory; `src/lib/servers.ts` probes and ranks compatible candidates and retains backups.
5. `src/lib/latency.ts` measures idle latency. The current local capacity path
   uses `src/lib/capacityClient.ts`, `src/lib/capacityCore.ts`, and
   `src/workers/measurement.worker.ts`; the legacy throughput module remains
   available to bounded secondary verification. Loaded-latency probes run only
   while their corresponding directional load is active.
6. `src/lib/confidence.ts`, grading/scoring modules, and `src/lib/accuracyPassport.ts` derive explainable results after measurement phases finish.
7. The recorder keeps raw events synchronously and sends buffered UI batches at most every 100 ms. React and gauge/chart animation never schedule network measurement.
8. Completed or explicitly low-confidence results can enter local history and privacy-filtered raw evidence. Failed and cancelled runs are not published.

## State and cancellation

The phase journal covers created, preflight, discovery, probing, selection, idle latency, download/upload warm-ups and measurements, directional loaded latency, packet-loss availability, stability analysis, abnormal-result verification, confidence calculation, and terminal completed/low-confidence/failed/cancelled states.

Each phase has an attempt number, wall-clock and monotonic-relative timestamps, sample boundaries, duration, status, and sanitized error. Phase-specific retry is explicit in the event stream. A shared `AbortSignal` is propagated through endpoint discovery, probing, latency, throughput, trace, and the experimental UDP-reachability check. Cancellation discards partial headline values and closes in-flight work where browser APIs permit.

## Measurement and presentation isolation

Raw byte/sample accounting is performed inside the engine. The UI subscribes to typed event batches and uses presentation-only interpolation. It does not generate values or feed animation state back into formulas. The download needle, arc, ticks, chart, and value share the same measured presentation value; upload uses the same pattern. Reduced-motion changes interpolation, never the underlying result.

The capacity worker is a client-isolation boundary, not a security boundary.
It protects measurement timing from React/chart/gauge work but still operates
with the page's origin authority. Session grants, rate limits, byte budgets,
and endpoint validation must be enforced by future test nodes.

## Target control and data planes

```text
                         NetPulse control plane
Browser  <--- HTTPS ---> directory / version / optional session grant
  |
  | direct HTTPS/WSS/WebRTC; test payload never proxied by web hosting
  v
Selected regional test node
  |-- latency / download / upload receipt
  |-- controlled echo (only after validation)
  |-- public health / capacity / version
  `-- privacy-minimized operator telemetry

Independent monitors ---> node health, capacity and conformance
Validation lab ---------> controlled baseline and release evidence
```

The control plane publishes eligibility; it does not rewrite an individual
result. Node overload causes admission failure or explicit degraded mode, never
a fabricated low speed.

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

Certification requirements and the versioned result evidence contract are in
[ACCURACY_CERTIFICATION_PLAN.md](ACCURACY_CERTIFICATION_PLAN.md) and
[ACCURACY_PASSPORT_SCHEMA.md](ACCURACY_PASSPORT_SCHEMA.md).

## Extension rules

New measurements must declare a real source, formula, raw evidence, sample and failure counts, browser limitations, privacy treatment, cancellation behavior, confidence impact, and tests. A value that cannot meet that contract must remain unavailable or experimental. New regional endpoints must implement the reviewed contracts in [GLOBAL_ENDPOINTS.md](GLOBAL_ENDPOINTS.md) and [TEST_NODE_PROTOCOL.md](TEST_NODE_PROTOCOL.md), pass discovery/conformance checks, and pass independent capacity and accuracy gates before activation.
