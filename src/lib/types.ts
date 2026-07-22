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

export const SCHEMA_VERSION = 4;

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
  stopReason: "stable" | "duration" | "data-cap" | "completed" | "error";
  /** Requests that failed before the phase completed. */
  failedRequests: number;
  /** Loaded-latency probes that failed while traffic was active. */
  failedProbes: number;
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
};

export type RawMeasurementEvidence = {
  engineVersion: string;
  methodologyVersion: string;
  calibration: ClientCalibration;
  phases: PhaseJournalEntry[];
  events: MeasurementEvent[];
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

  loadedDown: Summary;
  loadedUp: Summary;

  bufferbloat: Bufferbloat;
  stability: Stability;
  packetLoss: PacketLoss;
  transportTelemetry: TransportTelemetry;
  ispLocation: IspLocation;
  confidence: Confidence;
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
