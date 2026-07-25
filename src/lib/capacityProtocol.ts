import type { DirectionCapacity, StreamDiagnostic } from "./types";

export type CapacityPlan = {
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
