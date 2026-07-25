# NetPulse test node protocol

Status: Phase 1 design; no public NetPulse node implements this protocol
Protocol version: proposed `1`

## 1. Purpose and boundary

A NetPulse test node is a dedicated regional data plane. It serves bounded
download, upload, latency, echo, health, and version operations directly to the
browser. Throughput traffic MUST NOT transit the Vercel web/control plane.

The protocol does not return a precomputed connection speed or diagnosis. It
returns data and evidence from which the browser calculates a result.

## 2. Origin and transport

- Public production operations MUST use HTTPS/WSS.
- Nodes SHOULD support HTTP/2 and HTTP/3, but MUST disclose the negotiated
  application protocol when safely observable.
- IPv4 and IPv6 addresses MUST be independently monitored.
- CORS MUST allow only reviewed NetPulse origins and local development origins
  explicitly configured by the operator.
- Responses MUST include a bounded request ID, protocol version, server build,
  region/node ID, `Cache-Control: no-store`, and applicable timing headers.
- Download responses MUST use `Content-Encoding: identity` or omit content
  encoding and MUST set `X-Content-Type-Options: nosniff`.
- Browser timing fields require an explicit `Timing-Allow-Origin`.

## 3. Capability discovery

`GET /v1/capabilities`

Example:

```json
{
  "schemaVersion": 1,
  "protocolVersion": 1,
  "nodeId": "use1-a-001",
  "regionId": "us-east",
  "provider": "example-provider",
  "buildVersion": "1.0.0",
  "addressFamilies": ["ipv4", "ipv6"],
  "applicationProtocols": ["h2", "h3"],
  "features": {
    "download": true,
    "uploadReceipt": true,
    "latency": true,
    "websocketEcho": true,
    "unreliableEcho": false,
    "health": true,
    "capacity": true,
    "transportTelemetry": false
  },
  "limits": {
    "maxDownloadBytes": 1000000000,
    "maxUploadBytes": 200000000,
    "maxStreams": 8,
    "maxDurationMs": 20000,
    "maxEchoMessages": 1000
  },
  "expiresAt": "2026-07-25T12:01:00Z"
}
```

Unknown protocol versions are incompatible. Unknown fields are ignored only
when the schema explicitly permits forward compatibility.

## 4. Session grant

`POST /v1/session`

A short-lived session grant is recommended before high-volume operations. It
MUST be scoped to:

- random session ID and nonce;
- node/region;
- permitted origin;
- expiry not exceeding two minutes;
- total download/upload byte budgets;
- maximum request bytes, streams, duration, and echo rate;
- protocol and minimum engine version;
- optional low-data flag.

The token MUST NOT contain a raw public IP, exact location, account identity,
or reusable credential. The server may bind it to a rotating abuse-control key
derived from the source address, but MUST NOT expose that key to the client.

Session issuance must fail closed on malformed input, expired challenges,
unsupported versions, overload, or rate limits. A challenge MAY be required
based on risk, but an accessible fallback is required.

## 5. Latency

`GET /v1/latency`

Requirements:

- status 204 or an exact tiny body;
- no database, template, or external service dependency;
- bounded server processing time exposed as
  `Server-Timing: app;dur=<milliseconds>`;
- no caching or compression;
- same region/interface class as throughput service;
- request ID and node/version headers.

The browser measures the complete request. Server processing time remains
separate evidence and MUST NOT be subtracted unless the methodology version
explicitly defines and validates that calculation.

## 6. Download

`GET /v1/download?bytes=N`

Requirements:

- `N` is an integer within the session/request limit;
- response contains exactly `N` application bytes unless the connection is
  aborted;
- bytes are generated from a preallocated or streaming incompressible source;
- no payload is read from personal data or durable storage;
- `Content-Length` equals `N` when the transport permits;
- response is not compressed or transformed;
- server does not log the query nonce or payload;
- overload returns an explicit non-2xx response before bulk transfer begins.

The node SHOULD expose:

```text
X-NetPulse-Protocol-Version: 1
X-NetPulse-Node: use1-a-001
X-NetPulse-Build: 1.0.0
X-NetPulse-Request-Id: bounded-opaque-id
X-NetPulse-Server-Start-Us: session-relative-monotonic
X-NetPulse-Server-End-Us: session-relative-monotonic
```

Absolute high-resolution server timestamps are unnecessary and increase
fingerprinting risk. Session-relative durations are preferred.

## 7. Upload and authoritative receipt

`POST /v1/upload`

The node MUST read and discard the entire bounded request body before returning
success. It MUST NOT persist, inspect beyond protocol validation, echo, parse
as user content, or forward the payload.

Success response:

```json
{
  "schemaVersion": 1,
  "protocolVersion": 1,
  "sessionId": "opaque-session",
  "requestId": "opaque-request",
  "acceptedBytes": 8388608,
  "receiveStartedUs": 1200042,
  "receiveEndedUs": 1285100,
  "receiveDurationUs": 85058,
  "bodyDigest": null,
  "nodeId": "use1-a-001",
  "buildVersion": "1.0.0"
}
```

Rules:

- `acceptedBytes` is the number delivered to the server application.
- Duration uses the node's monotonic clock and measures body receive only.
- The client verifies `receiveEndedUs - receiveStartedUs` against
  `receiveDurationUs` within integer rounding.
- The receipt is tied to the session/request and SHOULD be authenticated by
  the TLS session plus a short-lived session MAC/signature.
- Partial, over-limit, timed-out, or malformed bodies return failure and zero
  accepted bytes; they MUST NOT become successful measurements.
- A digest is unnecessary because the body is non-personal random load and
  retaining it increases CPU cost. If introduced for integrity testing, it
  MUST be explicitly profiled and excluded from the timed receive window.

## 8. WebSocket application echo

`WSS /v1/echo`

This endpoint can measure application delivery, latency, lateness, duplication,
and observed ordering. It cannot measure network packet loss because TCP
retransmits.

Client message:

```json
{
  "type": "netpulse-echo",
  "version": 1,
  "sessionId": "opaque-session",
  "sequence": 42,
  "clientSentMs": 1234.5
}
```

Response repeats only the validated version, session, sequence, and client
timestamp, plus an optional session-relative server receive/send duration. The
server MUST enforce message size, count, rate, session, origin, and connection
limits. It MUST NOT support arbitrary destinations or broadcast.

## 9. Unreliable delivery protocol

True browser-native loss needs a separately reviewed WebRTC data-channel or
TURN-backed protocol. It remains `false` in capabilities until independently
validated.

Minimum properties:

- unordered/unreliable channel configuration is explicit;
- fixed-size random probes with sequence and session IDs;
- client and server sent/received ledgers;
- duplicate, reorder, late, and invalid counts;
- bounded clock-independent loss formula;
- replay and cross-session rejection;
- reflection/amplification ratio at or below 1;
- TURN credential expiry and strict origin/session scope;
- no general relay or arbitrary peer functionality.

The formula is:

```text
loss_pct = 100 * (valid_sent - unique_valid_received) / valid_sent
```

The result is unavailable when session establishment, ledger reconciliation,
or minimum sample count fails.

## 10. Health and capacity

`GET /v1/health`

```json
{
  "schemaVersion": 1,
  "protocolVersion": 1,
  "nodeId": "use1-a-001",
  "status": "healthy",
  "checkedAt": "2026-07-25T12:00:00Z",
  "expiresAt": "2026-07-25T12:01:00Z",
  "loadPct": 34,
  "activeTests": 22,
  "maxConcurrentTests": 120,
  "interfaceCapacityMbps": 25000,
  "measuredAvailableCapacityMbps": 16200,
  "cpuPct": 28,
  "memoryPct": 41,
  "eventLoopDelayP95Ms": 3.2,
  "draining": false,
  "buildVersion": "1.0.0"
}
```

Capacity MUST come from current interface and admission telemetry, not VM
marketing specifications. A stale, unsigned/untrusted, malformed,
incompatible, draining, or unavailable report is not healthy.

`GET /v1/version` MAY return the same immutable protocol/build subset without
operational load fields.

## 11. Error model

Errors use a bounded JSON shape:

```json
{
  "schemaVersion": 1,
  "code": "NODE_OVERLOADED",
  "retryable": true,
  "retryAfterMs": 30000,
  "requestId": "opaque-request"
}
```

Required codes include incompatible version, invalid session, expired session,
origin denied, rate limited, byte limit, stream limit, overloaded, draining,
invalid request, timeout, and internal error. Responses MUST NOT include stack
traces, internal hostnames, addresses, credentials, or provider secrets.

## 12. Security and abuse controls

- Parse all numeric inputs with strict bounds and reject ambiguity.
- Enforce per-session, rotating per-address/coarse-prefix, and regional token
  buckets.
- Limit one full test per session and bound concurrent active tests.
- Stop accepting before interface saturation makes results inaccurate.
- Apply provider DDoS controls, origin ACLs, connection limits, and SYN/UDP
  protections.
- Do not implement arbitrary proxying, fetch-by-URL, reflection, file upload,
  storage, shell execution, or user-selected destinations.
- Separate measurement service identity from control/observability access.
- Rotate signing/HMAC keys and keep them out of the browser bundle.
- Sanitize logs and sample operational events; payload bodies are never logged.
- Challenge failures and rate limits MUST degrade honestly, not return a fake
  low throughput.

## 13. Privacy

Raw addresses may be processed transiently for routing and abuse defense.
Application logs SHOULD use rotating purpose-separated pseudonyms and coarse
region. Default targets:

- payload bodies: never retained;
- raw access logs: 24-72 hours only if operationally necessary;
- pseudonymous security events: documented short retention;
- coarse operational aggregates: 30 days;
- user result upload: opt-in and separate from node execution.

Exact periods and regional legal obligations require qualified review. This
protocol does not create universal compliance by itself.

## 14. Observability and activation

Nodes expose operator-only metrics for admission, phase errors, bytes,
duration, completion, response tails, interface load, CPU/memory, active
sessions, protocol families, receipt mismatches, echo failures, and cost.
Metrics MUST contain no payload or full address.

A node remains non-public until it passes:

1. protocol conformance and malformed-input tests;
2. exact byte/receipt reconciliation;
3. controlled bandwidth/latency/loss matrices;
4. concurrent client capacity and overload admission;
5. IPv4/IPv6 and real-browser tests;
6. drain, failover, rollback, and version mismatch drills;
7. privacy, retention, rate-limit, DDoS, and logging review;
8. independent monitoring from outside its provider.

No test node is approved or deployed by this Phase 1 document.
