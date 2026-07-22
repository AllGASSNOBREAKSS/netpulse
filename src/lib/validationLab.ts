import { coefficientOfVariation, mean, median, percentile } from "./stats";

export const VALIDATION_LAB_SCHEMA_VERSION = 1;

export type ValidationStatus = "complete" | "failed" | "aborted";
export type ValidationBrowser = "chromium" | "firefox" | "webkit" | "chrome" | "edge" | "safari" | "other";
export type ValidationFault = "none" | "endpoint-failure" | "intermittent-outage" | "route-change";

export type ValidationRun = {
  schemaVersion: number;
  runId: string;
  startedAt: string;
  source: {
    kind: "controlled-lab";
    netPulseRevision: string;
    resultSchemaVersion: number;
    directoryRevision: string;
    mode: "engine" | "full-ui";
  };
  condition: {
    profileId: string;
    downloadMbps: number;
    uploadMbps: number;
    roundTripMs: number;
    jitterMs: number;
    packetLossPct: number;
    saturation: "none" | "download" | "upload" | "both";
    fault: ValidationFault;
  };
  environment: {
    browser: ValidationBrowser;
    browserVersion: string;
    operatingSystem: string;
    deviceClass: "desktop" | "laptop" | "mobile" | "tablet" | "low-power" | "high-performance" | "other";
    medium: "ethernet" | "wifi" | "mobile" | "vpn" | "unknown";
    ipVersion: "ipv4" | "ipv6" | "dual" | "unknown";
    tabState: "foreground" | "background";
    powerMode: "normal" | "battery-saver" | "unknown";
    cpuLoad: "normal" | "high" | "unknown";
    region: string;
    endpointId: string;
  };
  baseline: {
    source: "iperf3-and-ping" | "iperf3" | "ping" | "configured-only";
    downloadMbps: number | null;
    uploadMbps: number | null;
    idleLatencyMs: number | null;
    jitterMs: number | null;
    packetLossPct: number | null;
    bufferbloatDownMs: number | null;
    bufferbloatUpMs: number | null;
  };
  outcome: {
    status: ValidationStatus;
    downloadMbps: number | null;
    uploadMbps: number | null;
    idleLatencyMs: number | null;
    jitterMs: number | null;
    bufferbloatDownMs: number | null;
    bufferbloatUpMs: number | null;
    confidenceScore: number | null;
    timeToStableMs: number | null;
    durationMs: number;
    dataTransferredBytes: number;
    downloadFailed: boolean;
    uploadFailed: boolean;
    packetLossStatus: "measured" | "unavailable";
    endpointHealthStatus: "healthy" | "degraded" | "draining" | "unavailable" | "unknown";
    failureCode: string | null;
  };
  performance: {
    longTaskCount: number | null;
    longTaskTotalMs: number | null;
    maxFrameDelayMs: number | null;
    heapUsedBytes: number | null;
    cpuUsagePct: number | null;
    unavailableReasons: string[];
  };
};

export type ValidationRejection = { index: number; runId: string | null; reasons: string[] };
export type ValidationDataset = {
  accepted: ValidationRun[];
  rejected: ValidationRejection[];
  duplicates: string[];
};

export type ValidationTolerance = {
  throughputMedianErrorPct: number;
  throughputP95ErrorPct: number;
  repeatabilityCovPct: number;
  latencyMedianErrorMs: number;
  latencyP95ErrorMs: number;
  failureRatePct: number;
};

export type ValidationSummary = {
  key: string;
  runs: number;
  completeRuns: number;
  completionRatePct: number;
  downloadMedianErrorPct: number | null;
  downloadMeanErrorPct: number | null;
  downloadP95ErrorPct: number | null;
  uploadMedianErrorPct: number | null;
  uploadMeanErrorPct: number | null;
  uploadP95ErrorPct: number | null;
  latencyMedianErrorMs: number | null;
  latencyMeanErrorMs: number | null;
  latencyP95ErrorMs: number | null;
  downloadVariationPct: number | null;
  uploadVariationPct: number | null;
  confidenceBrierScore: number | null;
  meanDataMB: number | null;
  meanDurationMs: number | null;
  downloadFailureRatePct: number;
  uploadFailureRatePct: number;
  tolerance: ValidationTolerance;
  passesLaunchGate: boolean;
};

const FORBIDDEN_PRIVATE_KEYS = new Set([
  "ip",
  "publicip",
  "clientip",
  "rawip",
  "latitude",
  "longitude",
  "coordinates",
  "exactlocation",
  "streetaddress",
  "email",
]);

export function toleranceForSpeed(downloadMbps: number): ValidationTolerance {
  if (downloadMbps <= 100) {
    return {
      throughputMedianErrorPct: 10,
      throughputP95ErrorPct: 20,
      repeatabilityCovPct: 5,
      latencyMedianErrorMs: 3,
      latencyP95ErrorMs: 8,
      failureRatePct: 1,
    };
  }
  if (downloadMbps <= 1_000) {
    return {
      throughputMedianErrorPct: 12,
      throughputP95ErrorPct: 25,
      repeatabilityCovPct: 6,
      latencyMedianErrorMs: 3,
      latencyP95ErrorMs: 8,
      failureRatePct: 1,
    };
  }
  return {
    throughputMedianErrorPct: 15,
    throughputP95ErrorPct: 30,
    repeatabilityCovPct: 8,
    latencyMedianErrorMs: 5,
    latencyP95ErrorMs: 12,
    failureRatePct: 2,
  };
}

export function absolutePercentError(measured: number, baseline: number): number | null {
  if (!Number.isFinite(measured) || !Number.isFinite(baseline) || baseline <= 0) return null;
  return (Math.abs(measured - baseline) / baseline) * 100;
}

export function parseValidationDataset(input: unknown): ValidationDataset {
  const rows = Array.isArray(input) ? input : isRecord(input) && Array.isArray(input.runs) ? input.runs : [];
  const accepted: ValidationRun[] = [];
  const rejected: ValidationRejection[] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();

  rows.forEach((row, index) => {
    const reasons: string[] = [];
    const run = parseRun(row, reasons);
    const runId = isRecord(row) && typeof row.runId === "string" ? row.runId : null;
    if (containsPrivateData(row)) reasons.push("Record contains a prohibited direct identifier or exact-location field.");
    if (run && seen.has(run.runId)) {
      duplicates.push(run.runId);
      reasons.push("Duplicate runId.");
    }
    if (run && reasons.length === 0) {
      seen.add(run.runId);
      accepted.push(run);
    } else {
      rejected.push({ index, runId, reasons: unique(reasons.length ? reasons : ["Record did not match the validation schema."]) });
    }
  });
  return { accepted, rejected, duplicates: unique(duplicates) };
}

export function summarizeValidationRuns(runs: ValidationRun[], key = "all"): ValidationSummary {
  const complete = runs.filter((run) => run.outcome.status === "complete");
  const downloadErrors = collectErrors(complete, "downloadMbps");
  const uploadErrors = collectErrors(complete, "uploadMbps");
  const latencyErrors = complete.flatMap((run) => {
    const measured = run.outcome.idleLatencyMs;
    const baseline = run.baseline.idleLatencyMs;
    return measured === null || baseline === null ? [] : [Math.abs(measured - baseline)];
  });
  const downloadValues = complete.flatMap((run) => run.outcome.downloadMbps === null ? [] : [run.outcome.downloadMbps]);
  const uploadValues = complete.flatMap((run) => run.outcome.uploadMbps === null ? [] : [run.outcome.uploadMbps]);
  const confidencePairs = complete.flatMap((run) => {
    if (run.outcome.confidenceScore === null) return [];
    return [{ predicted: run.outcome.confidenceScore / 100, actual: runPassesCoreTolerance(run) ? 1 : 0 }];
  });
  const tolerance = toleranceForSpeed(runs[0]?.condition.downloadMbps ?? 100);
  const failureRate = runs.length === 0 ? 0 : ((runs.length - complete.length) / runs.length) * 100;
  const result: ValidationSummary = {
    key,
    runs: runs.length,
    completeRuns: complete.length,
    completionRatePct: runs.length === 0 ? 0 : (complete.length / runs.length) * 100,
    downloadMedianErrorPct: aggregate(downloadErrors, median),
    downloadMeanErrorPct: aggregate(downloadErrors, mean),
    downloadP95ErrorPct: aggregate(downloadErrors, (values) => percentile(values, 95)),
    uploadMedianErrorPct: aggregate(uploadErrors, median),
    uploadMeanErrorPct: aggregate(uploadErrors, mean),
    uploadP95ErrorPct: aggregate(uploadErrors, (values) => percentile(values, 95)),
    latencyMedianErrorMs: aggregate(latencyErrors, median),
    latencyMeanErrorMs: aggregate(latencyErrors, mean),
    latencyP95ErrorMs: aggregate(latencyErrors, (values) => percentile(values, 95)),
    downloadVariationPct: variation(downloadValues),
    uploadVariationPct: variation(uploadValues),
    confidenceBrierScore: confidencePairs.length === 0
      ? null
      : mean(confidencePairs.map(({ predicted, actual }) => (predicted - actual) ** 2)),
    meanDataMB: aggregate(complete.map((run) => run.outcome.dataTransferredBytes / 1_000_000), mean),
    meanDurationMs: aggregate(complete.map((run) => run.outcome.durationMs), mean),
    downloadFailureRatePct: runs.length === 0 ? 0 : (runs.filter((run) => run.outcome.downloadFailed).length / runs.length) * 100,
    uploadFailureRatePct: runs.length === 0 ? 0 : (runs.filter((run) => run.outcome.uploadFailed).length / runs.length) * 100,
    tolerance,
    passesLaunchGate: false,
  };
  result.passesLaunchGate = complete.length >= 10
    && result.downloadMedianErrorPct !== null
    && result.downloadP95ErrorPct !== null
    && result.latencyMedianErrorMs !== null
    && result.latencyP95ErrorMs !== null
    && result.downloadVariationPct !== null
    && result.downloadMedianErrorPct <= tolerance.throughputMedianErrorPct
    && result.downloadP95ErrorPct <= tolerance.throughputP95ErrorPct
    && result.latencyMedianErrorMs <= tolerance.latencyMedianErrorMs
    && result.latencyP95ErrorMs <= tolerance.latencyP95ErrorMs
    && result.downloadVariationPct <= tolerance.repeatabilityCovPct
    && failureRate <= tolerance.failureRatePct;
  return result;
}

export function groupValidationRuns(
  runs: ValidationRun[],
  dimension: "speed" | "browser" | "region" | "endpoint",
): ValidationSummary[] {
  const groups = new Map<string, ValidationRun[]>();
  for (const run of runs) {
    const key = dimension === "speed"
      ? `${run.condition.downloadMbps} Mbps`
      : dimension === "browser"
        ? `${run.environment.browser} ${run.environment.browserVersion}`.trim()
        : dimension === "region"
          ? run.environment.region
          : run.environment.endpointId;
    const group = groups.get(key) ?? [];
    group.push(run);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, group]) => summarizeValidationRuns(group, key));
}

function runPassesCoreTolerance(run: ValidationRun): boolean {
  const tolerance = toleranceForSpeed(run.condition.downloadMbps);
  const downloadError = metricError(run, "downloadMbps");
  const uploadError = metricError(run, "uploadMbps");
  const measuredLatency = run.outcome.idleLatencyMs;
  const baselineLatency = run.baseline.idleLatencyMs;
  if (downloadError === null || uploadError === null || measuredLatency === null || baselineLatency === null) return false;
  return downloadError <= tolerance.throughputMedianErrorPct
    && uploadError <= tolerance.throughputMedianErrorPct
    && Math.abs(measuredLatency - baselineLatency) <= tolerance.latencyMedianErrorMs;
}

function collectErrors(runs: ValidationRun[], metric: "downloadMbps" | "uploadMbps"): number[] {
  return runs.flatMap((run) => {
    const error = metricError(run, metric);
    return error === null ? [] : [error];
  });
}

function metricError(run: ValidationRun, metric: "downloadMbps" | "uploadMbps"): number | null {
  const measured = run.outcome[metric];
  const baseline = run.baseline[metric];
  return measured === null || baseline === null ? null : absolutePercentError(measured, baseline);
}

function variation(values: number[]): number | null {
  return values.length < 2 ? null : coefficientOfVariation(values) * 100;
}

function aggregate(values: number[], fn: (items: number[]) => number): number | null {
  return values.length === 0 ? null : fn(values);
}

function parseRun(value: unknown, reasons: string[]): ValidationRun | null {
  if (!isRecord(value)) {
    reasons.push("Run must be an object.");
    return null;
  }
  const source = record(value.source, "source", reasons);
  const condition = record(value.condition, "condition", reasons);
  const environment = record(value.environment, "environment", reasons);
  const baseline = record(value.baseline, "baseline", reasons);
  const outcome = record(value.outcome, "outcome", reasons);
  const performance = record(value.performance, "performance", reasons);
  if (!source || !condition || !environment || !baseline || !outcome || !performance) return null;

  const schemaVersion = number(value.schemaVersion, "schemaVersion", reasons, 1);
  const runId = string(value.runId, "runId", reasons, 160);
  const startedAt = isoDate(value.startedAt, "startedAt", reasons);
  const sourceKind = enumValue(source.kind, ["controlled-lab"], "source.kind", reasons);
  const netPulseRevision = string(source.netPulseRevision, "source.netPulseRevision", reasons, 160);
  const resultSchemaVersion = number(source.resultSchemaVersion, "source.resultSchemaVersion", reasons, 0);
  const directoryRevision = string(source.directoryRevision, "source.directoryRevision", reasons, 160);
  const mode = enumValue(source.mode, ["engine", "full-ui"], "source.mode", reasons);
  const profileId = string(condition.profileId, "condition.profileId", reasons, 160);
  const downloadMbps = number(condition.downloadMbps, "condition.downloadMbps", reasons, 0.001, 10_000);
  const uploadMbps = number(condition.uploadMbps, "condition.uploadMbps", reasons, 0.001, 10_000);
  const roundTripMs = number(condition.roundTripMs, "condition.roundTripMs", reasons, 0, 10_000);
  const jitterMs = number(condition.jitterMs, "condition.jitterMs", reasons, 0, 10_000);
  const packetLossPct = number(condition.packetLossPct, "condition.packetLossPct", reasons, 0, 100);
  const saturation = enumValue(condition.saturation, ["none", "download", "upload", "both"], "condition.saturation", reasons);
  const fault = enumValue(condition.fault, ["none", "endpoint-failure", "intermittent-outage", "route-change"], "condition.fault", reasons);
  const browser = enumValue(environment.browser, ["chromium", "firefox", "webkit", "chrome", "edge", "safari", "other"], "environment.browser", reasons);
  const browserVersion = string(environment.browserVersion, "environment.browserVersion", reasons, 100);
  const operatingSystem = string(environment.operatingSystem, "environment.operatingSystem", reasons, 100);
  const deviceClass = enumValue(environment.deviceClass, ["desktop", "laptop", "mobile", "tablet", "low-power", "high-performance", "other"], "environment.deviceClass", reasons);
  const medium = enumValue(environment.medium, ["ethernet", "wifi", "mobile", "vpn", "unknown"], "environment.medium", reasons);
  const ipVersion = enumValue(environment.ipVersion, ["ipv4", "ipv6", "dual", "unknown"], "environment.ipVersion", reasons);
  const tabState = enumValue(environment.tabState, ["foreground", "background"], "environment.tabState", reasons);
  const powerMode = enumValue(environment.powerMode, ["normal", "battery-saver", "unknown"], "environment.powerMode", reasons);
  const cpuLoad = enumValue(environment.cpuLoad, ["normal", "high", "unknown"], "environment.cpuLoad", reasons);
  const region = string(environment.region, "environment.region", reasons, 100);
  const endpointId = string(environment.endpointId, "environment.endpointId", reasons, 100);
  const baselineSource = enumValue(baseline.source, ["iperf3-and-ping", "iperf3", "ping", "configured-only"], "baseline.source", reasons);
  const outcomeStatus = enumValue(outcome.status, ["complete", "failed", "aborted"], "outcome.status", reasons);
  const packetLossStatus = enumValue(outcome.packetLossStatus, ["measured", "unavailable"], "outcome.packetLossStatus", reasons);
  const endpointHealthStatus = enumValue(outcome.endpointHealthStatus, ["healthy", "degraded", "draining", "unavailable", "unknown"], "outcome.endpointHealthStatus", reasons);
  const downloadFailed = boolean(outcome.downloadFailed, "outcome.downloadFailed", reasons);
  const uploadFailed = boolean(outcome.uploadFailed, "outcome.uploadFailed", reasons);
  const durationMs = number(outcome.durationMs, "outcome.durationMs", reasons, 0, 3_600_000);
  const dataTransferredBytes = number(outcome.dataTransferredBytes, "outcome.dataTransferredBytes", reasons, 0, 100_000_000_000);
  const unavailableReasons = stringArray(performance.unavailableReasons, "performance.unavailableReasons", reasons);
  const baselineDownloadMbps = nullableNumber(baseline.downloadMbps, "baseline.downloadMbps", reasons);
  const baselineUploadMbps = nullableNumber(baseline.uploadMbps, "baseline.uploadMbps", reasons);
  const baselineIdleLatencyMs = nullableNumber(baseline.idleLatencyMs, "baseline.idleLatencyMs", reasons);
  const baselineJitterMs = nullableNumber(baseline.jitterMs, "baseline.jitterMs", reasons);
  const baselinePacketLossPct = nullableNumber(baseline.packetLossPct, "baseline.packetLossPct", reasons, 0, 100);
  const baselineBufferbloatDownMs = nullableNumber(baseline.bufferbloatDownMs, "baseline.bufferbloatDownMs", reasons);
  const baselineBufferbloatUpMs = nullableNumber(baseline.bufferbloatUpMs, "baseline.bufferbloatUpMs", reasons);
  const outcomeDownloadMbps = nullableNumber(outcome.downloadMbps, "outcome.downloadMbps", reasons);
  const outcomeUploadMbps = nullableNumber(outcome.uploadMbps, "outcome.uploadMbps", reasons);
  const outcomeIdleLatencyMs = nullableNumber(outcome.idleLatencyMs, "outcome.idleLatencyMs", reasons);
  const outcomeJitterMs = nullableNumber(outcome.jitterMs, "outcome.jitterMs", reasons);
  const outcomeBufferbloatDownMs = nullableNumber(outcome.bufferbloatDownMs, "outcome.bufferbloatDownMs", reasons);
  const outcomeBufferbloatUpMs = nullableNumber(outcome.bufferbloatUpMs, "outcome.bufferbloatUpMs", reasons);
  const confidenceScore = nullableNumber(outcome.confidenceScore, "outcome.confidenceScore", reasons, 0, 100);
  const timeToStableMs = nullableNumber(outcome.timeToStableMs, "outcome.timeToStableMs", reasons);
  const failureCode = nullableString(outcome.failureCode, "outcome.failureCode", reasons, 160);
  const longTaskCount = nullableNumber(performance.longTaskCount, "performance.longTaskCount", reasons, 0);
  const longTaskTotalMs = nullableNumber(performance.longTaskTotalMs, "performance.longTaskTotalMs", reasons, 0);
  const maxFrameDelayMs = nullableNumber(performance.maxFrameDelayMs, "performance.maxFrameDelayMs", reasons, 0);
  const heapUsedBytes = nullableNumber(performance.heapUsedBytes, "performance.heapUsedBytes", reasons, 0);
  const cpuUsagePct = nullableNumber(performance.cpuUsagePct, "performance.cpuUsagePct", reasons, 0, 100);

  if (reasons.length > 0 || schemaVersion === null || runId === null || startedAt === null || sourceKind === null
    || netPulseRevision === null || resultSchemaVersion === null || directoryRevision === null || mode === null
    || profileId === null || downloadMbps === null || uploadMbps === null || roundTripMs === null || jitterMs === null
    || packetLossPct === null || saturation === null || fault === null || browser === null || browserVersion === null
    || operatingSystem === null || deviceClass === null || medium === null || ipVersion === null || tabState === null
    || powerMode === null || cpuLoad === null || region === null || endpointId === null || baselineSource === null
    || outcomeStatus === null || packetLossStatus === null || endpointHealthStatus === null || downloadFailed === null || uploadFailed === null
    || durationMs === null || dataTransferredBytes === null || unavailableReasons === null) return null;

  if (schemaVersion !== VALIDATION_LAB_SCHEMA_VERSION) reasons.push(`Unsupported schemaVersion ${schemaVersion}.`);
  if (outcomeStatus === "complete" && (outcomeDownloadMbps === null
    || outcomeUploadMbps === null
    || outcomeIdleLatencyMs === null)) {
    reasons.push("Completed runs require download, upload, and idle-latency measurements.");
  }
  if (reasons.length > 0) return null;

  return {
    schemaVersion,
    runId,
    startedAt,
    source: { kind: sourceKind, netPulseRevision, resultSchemaVersion, directoryRevision, mode },
    condition: { profileId, downloadMbps, uploadMbps, roundTripMs, jitterMs, packetLossPct, saturation, fault },
    environment: { browser, browserVersion, operatingSystem, deviceClass, medium, ipVersion, tabState, powerMode, cpuLoad, region, endpointId },
    baseline: {
      source: baselineSource,
      downloadMbps: baselineDownloadMbps,
      uploadMbps: baselineUploadMbps,
      idleLatencyMs: baselineIdleLatencyMs,
      jitterMs: baselineJitterMs,
      packetLossPct: baselinePacketLossPct,
      bufferbloatDownMs: baselineBufferbloatDownMs,
      bufferbloatUpMs: baselineBufferbloatUpMs,
    },
    outcome: {
      status: outcomeStatus,
      downloadMbps: outcomeDownloadMbps,
      uploadMbps: outcomeUploadMbps,
      idleLatencyMs: outcomeIdleLatencyMs,
      jitterMs: outcomeJitterMs,
      bufferbloatDownMs: outcomeBufferbloatDownMs,
      bufferbloatUpMs: outcomeBufferbloatUpMs,
      confidenceScore,
      timeToStableMs,
      durationMs,
      dataTransferredBytes,
      downloadFailed,
      uploadFailed,
      packetLossStatus,
      endpointHealthStatus,
      failureCode,
    },
    performance: {
      longTaskCount,
      longTaskTotalMs,
      maxFrameDelayMs,
      heapUsedBytes,
      cpuUsagePct,
      unavailableReasons,
    },
  };
}

function containsPrivateData(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsPrivateData);
  if (!isRecord(value)) return false;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_PRIVATE_KEYS.has(key.toLowerCase().replaceAll("_", "").replaceAll("-", ""))) return true;
    if (containsPrivateData(nested)) return true;
  }
  return false;
}

function record(value: unknown, label: string, reasons: string[]): Record<string, unknown> | null {
  if (!isRecord(value)) {
    reasons.push(`${label} must be an object.`);
    return null;
  }
  return value;
}

function string(value: unknown, label: string, reasons: string[], max: number): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    reasons.push(`${label} must be a non-empty string no longer than ${max} characters.`);
    return null;
  }
  return value;
}

function nullableString(value: unknown, label: string, reasons: string[], max: number): string | null {
  if (value === null) return null;
  return string(value, label, reasons, max);
}

function number(value: unknown, label: string, reasons: string[], min = 0, max = Number.MAX_SAFE_INTEGER): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    reasons.push(`${label} must be a finite number from ${min} to ${max}.`);
    return null;
  }
  return value;
}

function nullableNumber(value: unknown, label: string, reasons: string[], min = 0, max = Number.MAX_SAFE_INTEGER): number | null {
  if (value === null) return null;
  return number(value, label, reasons, min, max);
}

function boolean(value: unknown, label: string, reasons: string[]): boolean | null {
  if (typeof value !== "boolean") {
    reasons.push(`${label} must be a boolean.`);
    return null;
  }
  return value;
}

function enumValue<const T extends string>(value: unknown, allowed: readonly T[], label: string, reasons: string[]): T | null {
  if (typeof value !== "string" || !allowed.some((item) => item === value)) {
    reasons.push(`${label} has an unsupported value.`);
    return null;
  }
  return allowed.find((item) => item === value) ?? null;
}

function isoDate(value: unknown, label: string, reasons: string[]): string | null {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    reasons.push(`${label} must be an ISO timestamp.`);
    return null;
  }
  return value;
}

function stringArray(value: unknown, label: string, reasons: string[]): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length > 240)) {
    reasons.push(`${label} must be an array of short strings.`);
    return null;
  }
  return value.filter((item): item is string => typeof item === "string");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
