/**
 * Deterministic Phase 2 semantic-validation fixtures.
 *
 * This module is test-only evidence. It never supplies production measurements
 * and it does not claim to emulate a browser, radio, route, or test endpoint.
 * Controlled Docker/tc/iperf3 runs remain the independent accuracy authority.
 */
import { selectComparableCapacity } from "./capacityCore";
import { coefficientOfVariation, mean, median, percentile } from "./stats";
import type { CapacityStage, StreamDiagnostic } from "./types";

export const PHASE_2_SPEED_TIERS_MBPS = [10, 25, 50, 100, 300, 500, 1_000, 2_500] as const;
export const PHASE_2_LATENCY_PROFILES_MS = [5, 20, 50, 100] as const;
export const PHASE_2_CONTROLLED_IMPAIRMENTS = [
  "clean",
  "jitter",
  "packet-loss",
  "asymmetric",
  "download-saturation",
  "upload-saturation",
  "endpoint-interruption",
  "browser-cancellation",
  "background-tab",
] as const;

export type Phase2DeterministicTrial = {
  speedTierMbps: number;
  trial: number;
  expectedMbps: number;
  maximumMbps: number | null;
  reliableMbps: number | null;
  singleStreamMbps: number | null;
  status: "complete" | "inconclusive";
  confidenceScore: number;
  durationMs: number;
  dataBytes: number;
};

export type Phase2TierSummary = {
  speedTierMbps: number;
  trials: number;
  medianResultMbps: number | null;
  meanErrorPct: number | null;
  medianAbsoluteErrorPct: number | null;
  p95ErrorPct: number | null;
  coefficientOfVariationPct: number | null;
  failureRatePct: number;
  inconclusiveRatePct: number;
  averageDurationMs: number;
  averageDataMB: number;
  medianConfidence: number;
};

const TRIAL_OFFSETS = [-0.04, -0.03, -0.025, -0.02, -0.015, -0.01, -0.005, 0, 0.005, 0.01,
  0.015, 0.02, 0.025, 0.03, 0.04, -0.012, -0.007, 0.007, 0.012, 0] as const;

export function runPhase2DeterministicTrials(repetitions = 20): Phase2DeterministicTrial[] {
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 100) {
    throw new Error("Deterministic repetitions must be an integer from 1 to 100.");
  }
  return PHASE_2_SPEED_TIERS_MBPS.flatMap((speed) =>
    Array.from({ length: repetitions }, (_, trial) => deterministicTrial(speed, trial))
  );
}

export function summarizePhase2DeterministicTrials(
  trials: Phase2DeterministicTrial[],
): Phase2TierSummary[] {
  return PHASE_2_SPEED_TIERS_MBPS.map((speedTierMbps) => {
    const tier = trials.filter((trial) => trial.speedTierMbps === speedTierMbps);
    const completed = tier.filter((trial) => trial.status === "complete" && trial.maximumMbps !== null);
    const values = completed.flatMap((trial) => trial.maximumMbps === null ? [] : [trial.maximumMbps]);
    const errors = completed.flatMap((trial) =>
      trial.maximumMbps === null ? [] : [Math.abs(trial.maximumMbps - trial.expectedMbps) / trial.expectedMbps * 100]
    );
    return {
      speedTierMbps,
      trials: tier.length,
      medianResultMbps: nullableAggregate(values, median),
      meanErrorPct: nullableAggregate(errors, mean),
      medianAbsoluteErrorPct: nullableAggregate(errors, median),
      p95ErrorPct: nullableAggregate(errors, (items) => percentile(items, 95)),
      coefficientOfVariationPct: values.length < 2 ? null : coefficientOfVariation(values) * 100,
      failureRatePct: tier.length === 0 ? 0 : tier.filter((trial) => trial.status !== "complete").length / tier.length * 100,
      inconclusiveRatePct: tier.length === 0 ? 0 : tier.filter((trial) => trial.status === "inconclusive").length / tier.length * 100,
      averageDurationMs: tier.length === 0 ? 0 : mean(tier.map((trial) => trial.durationMs)),
      averageDataMB: tier.length === 0 ? 0 : mean(tier.map((trial) => trial.dataBytes / 1_000_000)),
      medianConfidence: tier.length === 0 ? 0 : median(tier.map((trial) => trial.confidenceScore)),
    };
  });
}

function deterministicTrial(speed: number, trial: number): Phase2DeterministicTrial {
  const offset = TRIAL_OFFSETS[trial % TRIAL_OFFSETS.length];
  const stages = [
    deterministicStage("download-1-1s", 1, speed * 0.72 * (1 + offset), 2_500),
    deterministicStage("download-2-2s", 2, speed * 0.91 * (1 + offset), 2_800),
    deterministicStage("download-3-4s", 4, speed * (1 + offset), 3_500),
  ];
  const selection = selectComparableCapacity(stages, "download", 2_000, 3_000, 3, {
    minBytes: Math.max(1_000_000, speed * 1_000_000 / 8 * 1.5),
    minValidSamples: 5,
    maxVariationPct: 10,
  });
  const maximumMbps = selection.publication.maximum.valueMbps;
  const reliableMbps = selection.publication.reliable.valueMbps;
  const singleStreamMbps = selection.publication.singleStream.valueMbps;
  const consistent = maximumMbps !== null
    && reliableMbps !== null
    && singleStreamMbps !== null
    && maximumMbps >= reliableMbps
    && maximumMbps >= singleStreamMbps;
  return {
    speedTierMbps: speed,
    trial,
    expectedMbps: speed,
    maximumMbps,
    reliableMbps,
    singleStreamMbps,
    status: consistent ? "complete" : "inconclusive",
    confidenceScore: consistent ? 92 : 35,
    durationMs: stages.reduce((sum, stage) => sum + stage.durationMs, 0),
    dataBytes: stages.reduce((sum, stage) => sum + stage.bytes, 0),
  };
}

function deterministicStage(stageId: string, streams: number, centerMbps: number, durationMs: number): CapacityStage {
  const samples = [0.96, 0.985, 1, 1.01, 1.03, 1.005].map((factor) => centerMbps * factor);
  const bytes = Math.round(centerMbps * 1_000_000 / 8 * durationMs / 1_000);
  const diagnostic = deterministicDiagnostic(stageId, streams, bytes);
  return {
    stageId,
    streams,
    aggregateMbps: centerMbps,
    medianMbps: median(samples),
    trimmedMeanMbps: mean(samples.slice(1, -1)),
    p5Mbps: percentile(samples, 5),
    p50Mbps: percentile(samples, 50),
    p95Mbps: percentile(samples, 95),
    peakMbps: Math.max(...samples),
    variationPct: coefficientOfVariation(samples) * 100,
    coefficientOfVariation: coefficientOfVariation(samples),
    samples,
    validWindowCount: samples.length,
    bytes,
    durationMs,
    requestBytes: Math.max(1, Math.round(bytes / streams)),
    failedRequests: 0,
    failedProbes: 0,
    improvementPct: null,
    stopReason: "duration",
    rampState: streams === 1 ? "baseline" : streams === 4 ? "ceiling" : "ramping",
    endpointHealth: "healthy",
    qualification: {
      status: "qualified",
      durationQualified: true,
      bytesQualified: true,
      samplesQualified: true,
      variationQualified: true,
      endpointQualified: true,
      completionQualified: true,
      receiptQualified: true,
      cacheQualified: true,
      compressionQualified: true,
      reasons: [],
    },
    diagnostics: [diagnostic],
  };
}

function deterministicDiagnostic(stageId: string, streams: number, bytes: number): StreamDiagnostic {
  return {
    direction: "download",
    stage: "measurement",
    stageStreams: streams,
    streamId: 0,
    requestId: 0,
    endpoint: "https://controlled.invalid/down",
    startedAtMs: 0,
    responseAtMs: 5,
    firstByteAtMs: 7,
    endedAtMs: 1_000,
    timeToFirstByteMs: 5,
    transferDurationMs: 993,
    bytes,
    transferMbps: bytes * 8 / 993 / 1_000,
    httpStatus: 200,
    protocol: "h2",
    cacheControl: "no-store, no-transform",
    contentEncoding: null,
    contentLength: bytes,
    clientAttemptedBytes: 0,
    serverAcceptedBytes: null,
    serverReceiveDurationMs: null,
    uploadReceipt: null,
    outcome: "completed",
    failureReason: null,
  };
}

function nullableAggregate(values: number[], aggregate: (items: number[]) => number): number | null {
  return values.length === 0 ? null : aggregate(values);
}
