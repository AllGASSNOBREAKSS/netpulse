import type { ClientCalibration } from "./clientCalibration";
import type { MeasurementEvent, PhaseJournalEntry } from "./measurementPipeline";
import { ENGINE_VERSION, METHODOLOGY_VERSION } from "./measurementPipeline";
import type {
  AccuracyPassport,
  Confidence,
  Sample,
  SecondaryVerification,
  ServerSelection,
  ThroughputStats,
  TransportTelemetry,
  IpFamilyComparison,
} from "./types";

export function buildAccuracyPassport(input: {
  confidence: Confidence;
  samples: Sample[];
  idleFailed: number;
  download: ThroughputStats;
  upload: ThroughputStats;
  server: ServerSelection;
  dataBytes: number;
  durationMs: number;
  ipFamily: "IPv4" | "IPv6" | "unknown";
  browserForeground: boolean;
  limitations: string[];
  calibration: ClientCalibration;
  phases: PhaseJournalEntry[];
  events: MeasurementEvent[];
  secondaryVerification: SecondaryVerification;
  transportTelemetry: TransportTelemetry;
  ipComparison: IpFamilyComparison;
}): AccuracyPassport {
  const failedRequests = input.download.failedRequests + input.upload.failedRequests;
  const failedProbes = input.idleFailed + input.download.failedProbes + input.upload.failedProbes;
  const reducedConfidenceReasons = [
    ...input.confidence.reasons.filter((reason) => !reason.ok).map((reason) => `${reason.label}: ${reason.detail}`),
    ...input.calibration.warnings,
  ];
  const phaseRetryCount = input.events.filter((event) => event.kind === "phase-retry").length;

  return {
    confidenceScore: input.confidence.score,
    confidenceLabel: input.confidence.score >= 85 ? "high" : input.confidence.score >= 60 ? "moderate" : "low",
    validSampleCount: input.samples.length,
    invalidSampleCount: failedRequests + failedProbes,
    endpointId: input.server.chosen.id,
    endpointLabel: `${input.server.chosen.regionLabel} (${input.server.chosen.provider})`,
    endpointLoadPct: input.server.chosen.loadPct,
    endpointHealth: input.server.chosen.healthStatus,
    secondaryVerification: input.secondaryVerification,
    transportTelemetry: input.transportTelemetry,
    ipComparison: input.ipComparison,
    bytesTransferred: input.dataBytes,
    durationMs: input.durationMs,
    downloadStreams: input.download.streams,
    uploadStreams: input.upload.streams,
    ipFamily: input.ipFamily,
    browserForeground: input.browserForeground,
    engineVersion: ENGINE_VERSION,
    methodologyVersion: METHODOLOGY_VERSION,
    phaseRetryCount,
    knownLimitations: [...input.limitations],
    reducedConfidenceReasons,
  };
}
