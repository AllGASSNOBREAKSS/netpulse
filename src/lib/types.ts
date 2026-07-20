/**
 * Shared type model for the NetPulse measurement pipeline.
 *
 * The result is versioned (`schemaVersion`). Top-level convenience fields
 * (downloadMbps, idlePingMs, …) mirror values inside the richer nested blocks
 * so older UI and stored history keep working; the nested blocks carry the
 * full statistical detail added in the v2 engine.
 */
import type { Summary } from "./stats";
export type { Summary };

export const SCHEMA_VERSION = 2;

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
  /** navigator.connection.effectiveType when exposed, else null. */
  connectionType: string | null;
  /** Heuristic only — never asserted as fact. */
  vpnProxy: "possible" | "unlikely" | "unknown";
  vpnProxyReason: string;
  estimatedDurationSec: number;
  estimatedDataMB: number;
};

/* ---- Server --------------------------------------------------------------- */
export type ServerProbe = {
  id: string;
  provider: string;
  city: string | null;
  region: string | null;
  approxDistanceKm: number | null;
  asn: string | null;
  protocol: string; // e.g. "HTTPS (fetch)"
  ipFamily: "IPv4" | "IPv6" | "unknown";
  latency: Summary;
  available: boolean;
  /** 0–1 relative ranking score (higher is better). */
  rank: number;
};

export type ServerSelection = {
  chosen: ServerProbe;
  candidates: ServerProbe[];
  reason: string;
  manual: boolean;
};

/* ---- Throughput ----------------------------------------------------------- */
export type ThroughputStats = {
  /** Reliable representative figure (median of top-half of samples). */
  mbps: number;
  peakMbps: number;
  samples: number[]; // raw per-window Mbps samples
  cov: number; // coefficient of variation of the stable window
  bytes: number;
  durationMs: number;
  earlyStopped: boolean;
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
  throughputCov: number; // download throughput variation
};

/* ---- Packet loss (experimental) ------------------------------------------- */
export type PacketLoss = {
  status: "experimental" | "unavailable";
  /** UDP egress reachability via STUN — a real signal, but NOT end-to-end loss. */
  udpReachable: TriState;
  stunRttMs: number | null;
  candidateTypes: string[]; // e.g. ["host","srflx"]
  method: string;
  note: string;
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
export type ConfidenceReason = { label: string; ok: boolean; detail: string };
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
  forceIpFamily?: "auto" | "v4" | "v6";
};

/* ---- Full result ---------------------------------------------------------- */
export type TestResult = {
  schemaVersion: number;
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
  ispLocation: IspLocation;
  confidence: Confidence;

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
  onPartial?: (partial: Partial<TestResult>) => void;
  onPreflight?: (p: Preflight) => void;
  onServer?: (s: ServerSelection) => void;
};
