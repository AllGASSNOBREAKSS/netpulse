# NetPulse Accuracy Passport schema

Status: Phase 2 schema contract
Purpose: make each result inspectable and reproducible without exposing
personal identifiers

## 1. Semantics

An Accuracy Passport is evidence attached to one completed or explicitly
low-confidence test. It is not a certificate, warranty, or proof that the
endpoint was unconstrained. It explains what ran, what was observed, what was
unavailable, and why confidence changed.

The schema is append-only within a major version. Formula or semantic changes
require a new methodology version; incompatible field changes require a new
schema version.

## 2. Required envelope

```ts
type AccuracyPassportV1 = {
  schemaVersion: 1;
  runId: string;
  createdAt: string;
  terminalStatus:
    | "complete"
    | "complete-with-limitations"
    | "quick-estimate"
    | "low-confidence"
    | "inconclusive"
    | "incomplete"
    | "failed";
  engineVersion: string;
  methodologyVersion: string;
  profile: "full" | "lowData" | "quick";
  directory: DirectoryEvidence;
  endpoint: EndpointEvidence;
  client: ClientEvidence;
  phases: PhaseEvidence[];
  download: DirectionEvidence;
  upload: DirectionEvidence;
  latency: LatencyEvidence;
  delivery: DeliveryEvidence;
  secondaryVerification: SecondaryEvidence;
  transport: TransportEvidence;
  confidence: ConfidenceEvidence;
  limitations: string[];
  privacy: PrivacyEvidence;
};
```

Every nullable field must distinguish `unavailable` from a numeric zero.
Serialized JSON uses `null`; user interfaces use a clear unavailable label.

## 3. Directory and endpoint

```ts
type DirectoryEvidence = {
  schemaVersion: number;
  revision: string;
  source: "network-directory" | "built-in-fallback";
  warning: string | null;
  supportedRegions: number;
  unsupportedRegions: number;
};

type EndpointEvidence = {
  id: string;
  nodeId: string | null;
  provider: string;
  regionId: string;
  regionLabel: string;
  city: string | null;
  countryCode: string | null;
  protocolVersion: number | null;
  buildVersion: string | null;
  addressFamily: "ipv4" | "ipv6" | "dual" | "unknown";
  health: "healthy" | "degraded" | "draining" | "unavailable" | "unknown";
  loadPct: number | null;
  availableCapacityMbps: number | null;
  activeTests: number | null;
  selection: {
    automatic: boolean;
    score: number;
    medianProbeMs: number;
    p95ProbeMs: number;
    jitterMs: number;
    successes: number;
    failures: number;
    reason: string;
  };
  alternatives: Array<{
    id: string;
    provider: string;
    regionLabel: string;
    score: number;
    reason: string;
  }>;
};
```

Endpoint URLs are reduced to public canonical origin/path labels. Query
identifiers, session grants, private health URLs, and credentials are excluded.

## 4. Client evidence

```ts
type ClientEvidence = {
  browserFamily: string;
  browserVersion: string | null;
  osFamily: string;
  deviceClass: "mobile" | "tablet" | "desktop" | "unknown";
  workerUsed: boolean;
  foregroundThroughout: boolean;
  reducedMotion: boolean;
  timerResolutionMs: number | null;
  eventLoopWarnings: string[];
  connectionApi: {
    effectiveType: string | null;
    downlinkMbps: number | null;
    treatedAsGroundTruth: false;
  };
  ipv4: FamilyProbeEvidence;
  ipv6: FamilyProbeEvidence;
};
```

User agent detail is bounded to non-identifying family/version fields.
Hardware model, SSID, device name, exact core/memory fingerprint, and stable
fingerprinting identifiers are prohibited.

## 5. Direction evidence

```ts
type DirectionEvidence = {
  status: "measured" | "quick-estimate" | "inconclusive";
  maximumMbps: number | null;
  reliableMbps: number | null;
  singleStreamMbps: number | null;
  medianMbps: number;
  p5Mbps: number;
  p95Mbps: number;
  peakMbps: number;
  sampleCount: number;
  variationPct: number;
  selectedStreams: number;
  bytes: number;
  warmupBytes: number;
  durationMs: number;
  failedRequests: number;
  failedLoadedProbes: number;
  stopReason: string;
  stages: StageEvidence[];
  diagnostics: RequestDiagnostic[];
  limitation: string | null;
};

type StageEvidence = {
  stageId: string;
  streams: number;
  aggregateMbps: number;
  medianMbps: number;
  trimmedMeanMbps: number;
  p5Mbps: number;
  p50Mbps: number;
  p95Mbps: number;
  peakMbps: number;
  bytes: number;
  durationMs: number;
  requestBytes: number;
  sampleCount: number;
  variationPct: number;
  coefficientOfVariation: number;
  rampState: "baseline" | "ramping" | "saturation" | "ceiling";
  endpointHealth: "healthy" | "degraded" | "draining" | "unavailable" | "unknown";
  qualification: {
    status: "qualified" | "estimate-only" | "rejected";
    reasons: string[];
  };
  improvementPct: number | null;
  failedRequests: number;
  failedProbes: number;
  stopReason: string;
};
```

`streams` means concurrent browser requests, never transport connections.

Request diagnostics contain direction, stage, stage streams, stream/request
IDs, session-relative monotonic timestamps, TTFB, transfer duration, bytes,
transfer Mbps, HTTP status, protocol when visible, allowlisted cache/encoding/
length/receipt facts, outcome, and bounded failure reason. They exclude full
URLs with nonces, headers containing IP/location, bodies, and credentials.

## 6. Latency and delivery

```ts
type SummaryEvidence = {
  min: number;
  interquartileMean: number;
  mean: number;
  median: number;
  p90: number;
  p95: number;
  p99: number;
  jitter: number;
  standardDeviation: number;
  successes: number;
  failures: number;
};

type LatencyEvidence = {
  method: "https-application-rtt";
  idle: SummaryEvidence;
  downloadLoaded: SummaryEvidence;
  uploadLoaded: SummaryEvidence;
  bufferbloatDownloadMs: number;
  bufferbloatUploadMs: number;
  bufferbloatDownloadGrade: "A" | "B" | "C" | "D" | "F";
  bufferbloatUploadGrade: "A" | "B" | "C" | "D" | "F";
  stabilityScore: number;
  stabilityFormulaVersion: string;
};

type DeliveryEvidence = {
  packetLossPct: number | null;
  packetLossStatus: "measured" | "unavailable";
  udpReachable: "yes" | "no" | "unknown";
  transport: "webrtc-unreliable" | "websocket-echo" | "webrtc-stun" | "unavailable";
  sent: number | null;
  received: number | null;
  duplicates: number | null;
  reordered: number | null;
  late: number | null;
  applicationMessageLossPct: number | null;
  limitation: string;
};
```

WebSocket or STUN evidence never populates `packetLossPct`.

## 7. Secondary and transport

```ts
type SecondaryEvidence = {
  status: "agree" | "disagree" | "unavailable" | "failed";
  primaryEndpointId: string;
  secondaryEndpointId: string | null;
  providerIndependent: boolean;
  primaryMbps: number;
  secondaryMbps: number | null;
  differencePct: number | null;
  bytes: number;
  durationMs: number;
  reason: string;
};

type TransportEvidence = {
  browserProtocol: string | null;
  serverTransport: "tcp" | "quic" | "unknown";
  serverReportedTcpRttMs: number | null;
  serverReportedQuicRttMs: number | null;
  serverReportedRetransmits: number | null;
  source: "browser-resource-timing" | "server-headers" | "combined" | "unavailable";
  limitation: string;
};
```

## 8. Confidence

```ts
type ConfidenceEvidence = {
  score: number;
  modelVersion: string;
  calibrated: boolean;
  reasons: Array<{
    id: string;
    label: string;
    passed: boolean;
    detail: string;
    deduction: number;
  }>;
  summary: string;
};
```

`calibrated` remains false until the certification plan's reliability and
Brier gates pass for the relevant segment.

## 9. Privacy

```ts
type PrivacyEvidence = {
  publicIpStored: false;
  publicIpDisplay: "masked" | "unavailable";
  exactCoordinatesStored: false;
  payloadStored: false;
  localEvidenceRetentionRuns: 20;
  remoteResultUpload: "none" | "explicit-opt-in";
  approximateLocationSource: string | null;
  approximateLocationNotice: string | null;
};
```

The passport MUST NOT contain:

- complete public or private IP addresses;
- exact coordinates, street address, SSID, device name, email, account ID;
- request/session tokens, cache nonces, cookies, credentials, private URLs;
- upload/download payload content;
- unrestricted response headers;
- raw user agent or stable fingerprint.

## 10. JSON example

```json
{
  "schemaVersion": 1,
  "runId": "local-random-id",
  "createdAt": "2026-07-25T12:00:00.000Z",
  "terminalStatus": "low-confidence",
  "engineVersion": "4.1.0",
  "methodologyVersion": "2026.07.25-phase2-semantics-v1",
  "profile": "full",
  "endpoint": {
    "id": "cloudflare",
    "nodeId": null,
    "provider": "Cloudflare",
    "regionId": "global-anycast",
    "regionLabel": "Global anycast (provider routed)",
    "city": null,
    "countryCode": null,
    "protocolVersion": null,
    "buildVersion": null,
    "addressFamily": "unknown",
    "health": "unknown",
    "loadPct": null,
    "availableCapacityMbps": null,
    "activeTests": null
  },
  "delivery": {
    "packetLossPct": null,
    "packetLossStatus": "unavailable",
    "udpReachable": "yes",
    "transport": "webrtc-stun",
    "sent": null,
    "received": null,
    "duplicates": null,
    "reordered": null,
    "late": null,
    "applicationMessageLossPct": null,
    "limitation": "STUN reachability is not end-to-end packet loss."
  },
  "confidence": {
    "score": 62,
    "modelVersion": "penalty-v1",
    "calibrated": false,
    "reasons": [],
    "summary": "Moderate confidence; controlled calibration is pending."
  },
  "limitations": [
    "Only one provider endpoint was available.",
    "Endpoint load and capacity were unavailable."
  ],
  "privacy": {
    "publicIpStored": false,
    "publicIpDisplay": "masked",
    "exactCoordinatesStored": false,
    "payloadStored": false,
    "localEvidenceRetentionRuns": 20,
    "remoteResultUpload": "none",
    "approximateLocationSource": null,
    "approximateLocationNotice": null
  }
}
```

The example intentionally omits several required nested objects for readability;
production schema tests must require the complete envelope.
