import { describe, expect, it } from "vitest";
import {
  absolutePercentError,
  groupValidationRuns,
  parseValidationDataset,
  summarizeValidationRuns,
  toleranceForSpeed,
  type ValidationRun,
} from "../validationLab";

function run(overrides: Partial<ValidationRun["outcome"]> = {}, id = "run-1"): ValidationRun {
  return {
    schemaVersion: 1,
    runId: id,
    startedAt: "2026-07-21T12:00:00.000Z",
    source: {
      kind: "controlled-lab",
      netPulseRevision: "working-tree",
      resultSchemaVersion: 2,
      directoryRevision: "lab-v1",
      mode: "engine",
    },
    condition: {
      profileId: "100down-20up-rtt20",
      downloadMbps: 100,
      uploadMbps: 20,
      roundTripMs: 20,
      jitterMs: 0,
      packetLossPct: 0,
      saturation: "none",
      fault: "none",
    },
    environment: {
      browser: "chromium",
      browserVersion: "1.61.0",
      operatingSystem: "Linux container",
      deviceClass: "desktop",
      medium: "ethernet",
      ipVersion: "ipv4",
      tabState: "foreground",
      powerMode: "normal",
      cpuLoad: "normal",
      region: "controlled-local",
      endpointId: "lab-endpoint",
    },
    baseline: {
      source: "iperf3-and-ping",
      downloadMbps: 98,
      uploadMbps: 19.5,
      idleLatencyMs: 20.5,
      jitterMs: 0.8,
      packetLossPct: 0,
      bufferbloatDownMs: 5,
      bufferbloatUpMs: 8,
    },
    outcome: {
      status: "complete",
      downloadMbps: 96,
      uploadMbps: 19,
      idleLatencyMs: 22,
      jitterMs: 1.2,
      bufferbloatDownMs: 7,
      bufferbloatUpMs: 10,
      confidenceScore: 92,
      timeToStableMs: 4_500,
      durationMs: 20_000,
      dataTransferredBytes: 100_000_000,
      downloadFailed: false,
      uploadFailed: false,
      packetLossStatus: "unavailable",
      endpointHealthStatus: "healthy",
      failureCode: null,
      ...overrides,
    },
    performance: {
      longTaskCount: 0,
      longTaskTotalMs: 0,
      maxFrameDelayMs: 18,
      heapUsedBytes: null,
      cpuUsagePct: null,
      unavailableReasons: ["Heap and CPU telemetry are not portable browser APIs."],
    },
  };
}

describe("validation-lab statistics", () => {
  it("uses the independent baseline instead of the configured shaper target", () => {
    expect(absolutePercentError(96, 98)).toBeCloseTo(2.0408, 3);
    expect(absolutePercentError(96, 0)).toBeNull();
  });

  it("summarizes completion, error, variation, confidence calibration, and data use", () => {
    const runs = Array.from({ length: 10 }, (_, index) => run({ downloadMbps: 96 + index * 0.1 }, `run-${index}`));
    const summary = summarizeValidationRuns(runs);
    expect(summary.runs).toBe(10);
    expect(summary.completionRatePct).toBe(100);
    expect(summary.downloadMedianErrorPct).toBeLessThan(2);
    expect(summary.downloadVariationPct).toBeLessThan(1);
    expect(summary.confidenceBrierScore).not.toBeNull();
    expect(summary.meanDataMB).toBe(100);
    expect(summary.passesLaunchGate).toBe(true);
  });

  it("requires at least ten repetitions before a segment can pass", () => {
    expect(summarizeValidationRuns([run()]).passesLaunchGate).toBe(false);
  });

  it("groups records without mixing browser versions", () => {
    const other = run({}, "run-2");
    other.environment.browserVersion = "1.60.0";
    expect(groupValidationRuns([run(), other], "browser")).toHaveLength(2);
  });

  it("uses wider but still bounded multi-gigabit tolerances", () => {
    expect(toleranceForSpeed(5_000).throughputMedianErrorPct).toBe(15);
    expect(toleranceForSpeed(100).throughputMedianErrorPct).toBe(10);
  });
});

describe("validation-lab data quality", () => {
  it("accepts a complete privacy-minimized record", () => {
    const parsed = parseValidationDataset([run()]);
    expect(parsed.accepted).toHaveLength(1);
    expect(parsed.rejected).toHaveLength(0);
  });

  it("rejects duplicate runs and direct identifiers", () => {
    const privateRun = { ...run({}, "private"), publicIp: "203.0.113.1" };
    const parsed = parseValidationDataset([run(), run(), privateRun]);
    expect(parsed.accepted).toHaveLength(1);
    expect(parsed.duplicates).toEqual(["run-1"]);
    expect(parsed.rejected.find((item) => item.runId === "run-1")?.reasons).toContain("Duplicate runId.");
    expect(parsed.rejected.find((item) => item.runId === "private")?.reasons.join(" ")).toMatch(/prohibited direct identifier/i);
  });

  it("rejects a completed result missing a core measurement", () => {
    const parsed = parseValidationDataset([run({ downloadMbps: null })]);
    expect(parsed.accepted).toHaveLength(0);
    expect(parsed.rejected[0].reasons.join(" ")).toMatch(/Completed runs require/);
  });

  it("rejects malformed optional baseline and performance values", () => {
    const malformed = run();
    Object.assign(malformed.baseline, { jitterMs: "not-a-number" });
    Object.assign(malformed.performance, { cpuUsagePct: 120 });
    const parsed = parseValidationDataset([malformed]);
    expect(parsed.accepted).toHaveLength(0);
    expect(parsed.rejected[0].reasons.join(" ")).toMatch(/baseline\.jitterMs/);
    expect(parsed.rejected[0].reasons.join(" ")).toMatch(/performance\.cpuUsagePct/);
  });
});
