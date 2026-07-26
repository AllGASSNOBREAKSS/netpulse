/**
 * Shared type model for the NetPulse measurement pipeline.
 *
 * The result is versioned (`schemaVersion`). Top-level convenience fields
 * (downloadMbps, idlePingMs, …) mirror values inside the richer nested blocks
 * so older UI and stored history keep working; the nested blocks carry the
 * full statistical detail added by the current engine.
 */
import type { EndpointHealthStatus, RegionalCoverage } from "./globalNetwork";
import type { ClientCalibration } from "./clientCalibration";
import type { MeasurementEvent, PhaseJournalEntry, PipelinePhase } from "./measurementPipeline";
import type { Summary } from "./stats";
export type { Summary };

export const SCHEMA_VERSION = 5;

export type Phase =
  | "idle"
  | "preflight"
  | "server"
  | "latency"
  | "download_single"
  | "download_multi"
  | "upload"
  | "packetloss"
  | "done"
  | "cancelled"
  | "error";

/** Raw event sample streamed to the UI during a run. */
export type Sample = {
  t: number; // ms since test start (performance.now based)
  phase: Phase;
  mbps?: number; // instantaneous throughput sample
  rttMs?: number; // latency probe result
  streamMode?: "single" | "multi";
};

/* ---- Preflight ------------------------------------------------------------ */
export type TriState = "yes" | "no" | "unknown";

export type Preflight = {
  browser: string;
  os: string;
  deviceClass: "desktop" | "mobile" | "tablet" | "unknown";
  tabForeground: boolean;
  secureContext: boolean;
  ipv4: TriState;
  ipv6: TriState;
  ipComparison: IpFamilyComparison;
  /** navigator.connection.effectiveType when exposed, else null. */
  connectionType: string | null;
  /** Heuristic only — never asserted as fact. */
  vpnProxy: "possible" | "unlikely" | "unknown";
  vpnProxyReason: string;
  estimatedDurationSec: number;
  /** Typical application payload for the selected profile. */
  estimatedDataMB: number;
  /** Configured application-payload ceiling before small in-flight overshoot. */
  estimatedDataMaxMB: number;
};

/* ---- Server --------------------------------------------------------------- */
export type ServerProbe = {
  id: string;
  provider: string;
  regionId: string;
  regionLabel: string;
  /** Cloudflare three-letter serving data-center code, not a client city. */
  edgeCode: string | null;
  /** Country code reported for the client by the measurement provider. */
  clientCountryCode: string | null;
  /** Unavailable unless supplied by a documented endpoint metadata source. */
  city: string | null;
  region: string | null;
  approximateDistanceKm: number | null;
  protocol: string; // e.g. "HTTPS (fetch)"
  ipFamily: "IPv4" | "IPv6" | "unknown";
  latency: Summary;
  available: boolean;
  attempted: number;
  failed: number;
  /** Successful latency probes divided by attempts (0–1). */
  availability: number;
  /** 0–1 relative ranking score (higher is better). */
  rank: number;
  /** Consistency of observed HTTPS probes, not traceroute/path visibility. */
  routeConsistency: number;
  healthStatus: EndpointHealthStatus;
  loadPct: number | null;
  capacityMbps: number | null;
  availableCapacityMbps: number | null;
  serverVersion: string | null;
  protocolVersion: number | null;
  healthReason: string;
};

export type IpFamilySample = {
  status: TriState;
  medianMs: number | null;
  p95Ms: number | null;
  jitterMs: number | null;
  successful: number;
  failed: number;
  method: string;
};

export type IpFamilyComparison = {
  ipv4: IpFamilySample;
  ipv6: IpFamilySample;
  preferred: "IPv4" | "IPv6" | "similar" | "unavailable";
  differenceMs: number | null;
  reason: string;
};

export type ServerSelection = {
  chosen: ServerProbe;
  candidates: ServerProbe[];
  backups: ServerProbe[];
  reason: string;
  manual: boolean;
  degraded: boolean;
  directoryRevision: string;
  directorySource: "network-directory" | "built-in-fallback";
  directoryWarning: string | null;
  coverage: RegionalCoverage[];
};

/* ---- Throughput ----------------------------------------------------------- */
export type StreamDiagnostic = {
  runId?: string;
  stageId?: string;
  direction: "download" | "upload";
  stage: "warmup" | "measurement";
  /** Active requests in this stage; null only for the legacy non-worker fallback. */
  stageStreams: number | null;
  streamId: number;
  requestId: number;
  /** Canonical public endpoint without cache-busting query values. */
  endpoint: string;
  /** Monotonic timestamps from performance.now(); never wall-clock identity data. */
  startedAtMs: number;
  responseAtMs: number | null;
  firstByteAtMs: number | null;
  measurementWindowStartedAtMs?: number | null;
  measurementWindowEndedAtMs?: number | null;
  endedAtMs: number;
  timeToFirstByteMs: number | null;
  transferDurationMs: number | null;
  bytes: number;
  transferMbps: number | null;
  httpStatus: number | null;
  protocol: string | null;
  cacheControl: string | null;
  contentEncoding: string | null;
  contentLength: number | null;
  requestBytes?: number;
  stageByteBudget?: number;
  browserVisibility?: "visible" | "hidden" | "prerender" | "unavailable";
  abortReason?: string | null;
  failureClassification?: CapacityFailureClassification | null;
  /** Application payload the client attempted to submit for this request. */
  clientAttemptedBytes: number;
  /** Provider receipt when explicitly exposed (for example cf-meta-upload-bytes). */
  serverAcceptedBytes: number | null;
  /** Server-side receive duration when a versioned receipt exposes it. */
  serverReceiveDurationMs: number | null;
  /** Versioned receipt metadata. Cloudflare's byte-only header is partial evidence. */
  uploadReceipt: UploadReceiptEvidence | null;
  outcome: "completed" | "aborted" | "failed";
  failureReason: string | null;
};

export type CapacityFailureClassification =
  | "endpoint-setup-timeout"
  | "endpoint-http-error"
  | "cors-or-network-fetch-failure"
  | "response-body-unavailable"
  | "response-body-empty"
  | "compressed-response-rejected"
  | "premature-duration-abort"
  | "parent-cancellation"
  | "browser-interruption"
  | "unknown-endpoint-failure";

export type CapacityStageStopReason =
  | "stable"
  | "duration"
  | "overall-duration"
  | "data-cap"
  | "completed"
  | "error"
  | "setup-timeout";

export type UploadReceiptStatus = "verified" | "partial" | "missing" | "mismatch" | "invalid";

export type UploadReceiptEvidence = {
  status: UploadReceiptStatus;
  receiptId: string | null;
  version: string | null;
  testId: string | null;
  stageId: string | null;
  complete: boolean | null;
  attemptedBytes: number;
  receivedBytes: number | null;
  serverDurationMs: number | null;
  disagreementBytes: number | null;
  disagreementPct: number | null;
  reasons: string[];
};

export type ThroughputStats = {
  /** Application payload bits divided by the phase's actual elapsed time. */
  mbps: number;
  peakMbps: number;
  medianMbps: number;
  p5Mbps: number;
  p95Mbps: number;
  variationPct: number;
  samples: number[]; // download windows or successfully submitted-upload observations
  cov: number; // coefficient of variation of the stable window
  bytes: number;
  /** Discarded connection warm-up payload, included in total data-use accounting. */
  warmupBytes: number;
  warmupSucceeded: boolean;
  /** Adaptive request payload used for the measured phase. */
  requestBytes: number;
  /** Concurrent requests actually used after warm-up calibration. */
  streams: number;
  /** Warm-up throughput used only to select payload and concurrency. */
  calibrationMbps: number | null;
  durationMs: number;
  earlyStopped: boolean;
  /** Elapsed phase time when the stable-window early-stop criterion was met. */
  stableAtMs: number | null;
  stopReason: CapacityStageStopReason;
  /** Requests that failed before the phase completed. */
  failedRequests: number;
  /** Loaded-latency probes that failed while traffic was active. */
  failedProbes: number;
  /** Per-request, privacy-filtered evidence. It never includes IP/location headers or cache IDs. */
  diagnostics: StreamDiagnostic[];
};

export type CapacityStage = {
  stageId: string;
  streams: number;
  configuredStreams?: number;
  retryAttempt?: 0 | 1;
  recoveredFromFailure?: boolean;
  recoveryReason?: CapacityFailureClassification | null;
  wallClockStartedAtMs?: number;
  firstRequestStartedAtMs?: number | null;
  firstResponseAtMs?: number | null;
  firstPayloadAtMs?: number | null;
  measurementStartedAtMs?: number | null;
  measurementEndedAtMs?: number | null;
  wallClockDurationMs?: number;
  stageByteBudget?: number;
  aggregateMbps: number;
  medianMbps: number;
  trimmedMeanMbps: number;
  p5Mbps: number;
  p50Mbps: number;
  p95Mbps: number;
  peakMbps: number;
  variationPct: number;
  coefficientOfVariation: number;
  /** Fixed-duration application-byte windows for both download and upload. */
  samples: number[];
  validWindowCount: number;
  bytes: number;
  durationMs: number;
  requestBytes: number;
  requestCount?: number;
  completedRequests?: number;
  failedRequests: number;
  failedProbes: number;
  improvementPct: number | null;
  stopReason: CapacityStageStopReason;
  rampState: "baseline" | "ramping" | "saturation" | "ceiling";
  endpointHealth: "healthy" | "degraded" | "draining" | "unavailable" | "unknown";
  qualification: StageQualification;
  diagnostics: StreamDiagnostic[];
};

export type StageQualificationStatus = "qualified" | "estimate-only" | "rejected";

export type StageQualification = {
  status: StageQualificationStatus;
  durationQualified: boolean;
  bytesQualified: boolean;
  samplesQualified: boolean;
  variationQualified: boolean;
  endpointQualified: boolean;
  completionQualified: boolean;
  receiptQualified: boolean;
  cacheQualified: boolean;
  compressionQualified: boolean;
  reasons: string[];
};

export type ReliableThroughput = {
  status: "measured" | "quick-estimate" | "inconclusive";
  mbps: number;
  singleStreamMbps: number;
  medianMbps: number;
  p5Mbps: number;
  p95Mbps: number;
  peakMbps: number;
  variationPct: number;
  samples: number[];
  sampleCount: number;
  streams: number;
  bytes: number;
  durationMs: number;
  method: string;
  limitation: string | null;
};

export type ThroughputPublicationStatus = "measured" | "quick-estimate" | "inconclusive";

export type ThroughputMetricPublication = {
  status: ThroughputPublicationStatus;
  valueMbps: number | null;
  reasons: string[];
};

export type DirectionPublication = {
  maximum: ThroughputMetricPublication;
  reliable: ThroughputMetricPublication;
  singleStream: ThroughputMetricPublication;
  comparisonBasis: string;
  excludedStageCount: number;
  semanticConsistency: {
    valid: boolean;
    reasons: string[];
  };
};

export type DirectionCapacity = {
  direction: "download" | "upload";
  maximumMbps: number;
  reliable: ReliableThroughput;
  singleStreamMbps: number;
  bytes: number;
  warmupBytes: number;
  durationMs: number;
  selectedStreams: number;
  endpoint: string;
  stages: CapacityStage[];
  diagnostics: StreamDiagnostic[];
  rtts: number[];
  failedRequests: number;
  failedProbes: number;
  warmupSucceeded: boolean;
  requestCompressionObserved: boolean;
  workerUsed: boolean;
  reducedConfidenceReasons: string[];
  publication: DirectionPublication;
};

/* ---- Bufferbloat ---------------------------------------------------------- */
export type BloatGrade = "A" | "B" | "C" | "D" | "F";

export type Bufferbloat = {
  downloadMs: number; // loaded-down median − idle median
  uploadMs: number; // loaded-up median − idle median
  downloadGrade: BloatGrade;
  uploadGrade: BloatGrade;
  overallGrade: BloatGrade; // the worse of the two
  formula: string;
};

/* ---- Stability ------------------------------------------------------------ */
export type Stability = {
  score: number; // 0–100
  latencyStddevMs: number;
  p95Ms: number;
  p99Ms: number;
  spikes: number;
  longestSpikeMs: number;
  throughputCov: number; // worse of download/upload throughput variation
  successfulProbes: number;
  failedProbes: number;
  completeness: number;
  formula: string;
};

/* ---- Packet loss (experimental) ------------------------------------------- */
export type PacketLoss = {
  status: "measured" | "experimental" | "unavailable";
  /** UDP egress reachability via STUN — a real signal, but NOT end-to-end loss. */
  udpReachable: TriState;
  stunRttMs: number | null;
  candidateTypes: string[]; // e.g. ["host","srflx"]
  transport: "webrtc-stun" | "websocket-echo" | "webrtc-datachannel" | "unavailable";
  sent: number | null;
  received: number | null;
  late: number | null;
  reordered: number | null;
  /** Reserved for a validated unreliable-datagram/WebRTC echo protocol. */
  packetLossPct: number | null;
  /** WebSocket application-message delivery loss; TCP retransmission hides packet loss. */
  messageLossPct: number | null;
  durationMs: number | null;
  method: string;
  note: string;
};

export type TransportTelemetry = {
  browserProtocol: string | null;
  serverTransport: "tcp" | "quic" | "unknown";
  serverReportedTcpRttMs: number | null;
  serverReportedQuicRttMs: number | null;
  serverReportedRetransmits: number | null;
  serverTiming: string | null;
  source: "browser-resource-timing" | "server-headers" | "combined" | "unavailable";
  reason: string;
};

/* ---- ISP / location ------------------------------------------------------- */
export type IspLocation = {
  ispHint: string | null; // best-effort; often the colo/ASN owner, not the retail ISP
  asn: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  ipFamily: "IPv4" | "IPv6" | "unknown";
  ipMasked: string; // never store/emit the full public IP
  vpnProxy: "possible" | "unlikely" | "unknown";
  note: string;
};

/* ---- Confidence ----------------------------------------------------------- */
export type ConfidenceReason = { label: string; ok: boolean; detail: string; penalty: number };
export type Confidence = {
  score: number; // 0–100
  reasons: ConfidenceReason[];
  summary: string;
};

/* ---- Config --------------------------------------------------------------- */
export type TestConfig = {
  lowData: boolean;
  /** Measurement profile. Defaults to lowData?"lowData":"full". "quick" is the
   *  light profile used by guided A/B diagnostics (Fix My Internet). */
  profile?: "full" | "lowData" | "quick";
  serverId?: string; // manual server pick
  signal?: AbortSignal;
  /** Explicit opt-in phase retry counts. Defaults to zero to avoid hidden data use. */
  phaseRetries?: Partial<Record<PipelinePhase, number>>;
};

export type SecondaryVerification = {
  status: "unavailable" | "latency-only" | "agree" | "disagree";
  endpointId: string | null;
  endpointLabel: string | null;
  primaryMbps: number;
  secondaryMbps: number | null;
  differencePct: number | null;
  bytesTransferred: number;
  durationMs: number | null;
  streams: number | null;
  method: "latency-only" | "lightweight-download" | "unavailable";
  reason: string;
};

export type AccuracyPassport = {
  confidenceScore: number;
  confidenceLabel: "high" | "moderate" | "low";
  validSampleCount: number;
  invalidSampleCount: number;
  endpointId: string;
  endpointLabel: string;
  endpointLoadPct: number | null;
  endpointHealth: EndpointHealthStatus;
  secondaryVerification: SecondaryVerification;
  transportTelemetry: TransportTelemetry;
  ipComparison: IpFamilyComparison;
  bytesTransferred: number;
  durationMs: number;
  downloadStreams: number;
  uploadStreams: number;
  ipFamily: "IPv4" | "IPv6" | "unknown";
  browserForeground: boolean;
  engineVersion: string;
  methodologyVersion: string;
  phaseRetryCount: number;
  knownLimitations: string[];
  reducedConfidenceReasons: string[];
  resultPublication: ResultPublication;
  profileEvidence: {
    selectedProfile: "full" | "lowData" | "quick";
    profileSource: "explicit" | "low-data-toggle" | "default-full";
    lowData: boolean;
    configuredDownloadDurationMs: number;
    configuredUploadDurationMs: number;
    configuredDownloadByteCeiling: number;
    configuredUploadByteCeiling: number;
    actualDownloadMeasuredDurationMs: number;
    actualUploadMeasuredDurationMs: number;
    actualDownloadBytes: number;
    actualUploadBytes: number;
  };
  stageQualification: {
    download: Array<{
      stageId: string;
      streams: number;
      status: StageQualificationStatus;
      measuredDurationMs: number;
      wallClockDurationMs: number;
      bytes: number;
      stopReason: CapacityStageStopReason;
      recoveredFromFailure: boolean;
      reasons: string[];
    }>;
    upload: Array<{
      stageId: string;
      streams: number;
      status: StageQualificationStatus;
      measuredDurationMs: number;
      wallClockDurationMs: number;
      bytes: number;
      stopReason: CapacityStageStopReason;
      recoveredFromFailure: boolean;
      reasons: string[];
    }>;
  };
};

export type ResultPublication = {
  accuracyCertified: false;
  labels: Array<"Low-confidence estimate." | "Quick estimate.">;
  outcome: "complete" | "complete-with-limitations" | "quick-estimate" | "low-confidence" | "inconclusive" | "incomplete" | "failed";
  outcomeReasons: string[];
  download: ThroughputMetricPublication;
  upload: ThroughputMetricPublication;
  disclosures: string[];
};

export type RawMeasurementEvidence = {
  engineVersion: string;
  methodologyVersion: string;
  calibration: ClientCalibration;
  phases: PhaseJournalEntry[];
  events: MeasurementEvent[];
  streamDiagnostics: StreamDiagnostic[];
};

/* ---- Full result ---------------------------------------------------------- */
export type TestResult = {
  schemaVersion: number;
  runId: string;
  engineVersion: string;
  methodologyVersion: string;
  timestamp: number;
  durationMs: number;
  lowData: boolean;

  preflight: Preflight;
  server: ServerSelection;

  idleLatency: Summary;
  idleFailed: number;

  download: { single: ThroughputStats; multi: ThroughputStats };
  upload: ThroughputStats;
  capacity: {
    download: DirectionCapacity;
    upload: DirectionCapacity;
  };

  loadedDown: Summary;
  loadedUp: Summary;

  bufferbloat: Bufferbloat;
  stability: Stability;
  packetLoss: PacketLoss;
  transportTelemetry: TransportTelemetry;
  ispLocation: IspLocation;
  confidence: Confidence;
  publication: ResultPublication;
  accuracyPassport: AccuracyPassport;
  rawEvidence: RawMeasurementEvidence;

  dataUsedMB: number;
  limitations: string[];
  samples: Sample[];

  /* ---- Convenience mirrors (kept for existing UI + history) ---- */
  downloadMbps: number;
  uploadMbps: number;
  idlePingMs: number;
  idleJitterMs: number;
  loadedDownPingMs: number;
  loadedUpPingMs: number;
  bufferbloatMs: number;
  bufferbloatGrade: BloatGrade;
  spikes: number;
  probeCount: number;
};

/* ---- Engine callbacks ----------------------------------------------------- */
export type EngineCallbacks = {
  onPhase?: (phase: Phase) => void;
  onSample?: (s: Sample) => void;
  /** Cumulative application payload successfully submitted or received during this run. */
  onBytes?: (totalBytes: number) => void;
  onPartial?: (partial: Partial<TestResult>) => void;
  onPreflight?: (p: Preflight) => void;
  onServer?: (s: ServerSelection) => void;
  /** Buffered progress batches; raw events remain retained in the result. */
  onEvents?: (events: MeasurementEvent[]) => void;
};
