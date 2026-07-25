import type { DirectionCapacity, StreamDiagnostic } from "./types";

export type CapacityPlan = {
  runId: string;
  direction: "download" | "upload";
  downloadUrlTemplate: string;
  uploadUrl: string;
  latencyUrl: string;
  endpoint: string;
  streamRamp: number[];
  maxDurationMs: number;
  maxBytes: number;
  maxRequestBytes: number;
  warmupBytes: number;
  stageMinMs: number;
  stageMaxMs: number;
  finalStageMinMs: number;
  stageMinBytes: number;
  minValidSamples: number;
  maxVariationPct: number;
  receiptTolerancePct: number;
  receiptToleranceBytes: number;
  profileMode: "full" | "lowData" | "quick";
  endpointHealth: "healthy" | "degraded" | "draining" | "unavailable" | "unknown";
  allowEarlyStatisticalStop: boolean;
  improvementThresholdPct: number;
  progressIntervalMs: number;
  latencyProbeIntervalMs: number;
};

export type CapacityWorkerRequest =
  | { type: "run"; id: string; plan: CapacityPlan }
  | { type: "cancel"; id: string };

export type CapacityWorkerResponse =
  | { type: "stage"; id: string; stage: "warmup" | "measurement"; streams: number }
  | { type: "progress"; id: string; mbps: number; bytes: number; streams: number }
  | { type: "latency"; id: string; rttMs: number }
  | { type: "diagnostic"; id: string; diagnostic: StreamDiagnostic }
  | { type: "complete"; id: string; result: DirectionCapacity }
  | { type: "error"; id: string; name: string; message: string };
