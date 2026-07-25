import { describe, expect, it } from "vitest";
import { selectComparableCapacity } from "../capacityCore";
import { METRICS } from "../metrics";
import { buildResultPublication } from "../resultPublication";
import type {
  CapacityStage,
  DirectionCapacity,
  StreamDiagnostic,
  TestResult,
  ThroughputPublicationStatus,
} from "../types";

describe("throughput publication invariants", () => {
  it("recalculates reliable throughput from comparable stages instead of allowing reliable > maximum", () => {
    const stages = [
      stage({ streams: 1, aggregateMbps: 100, samples: [96, 100, 104], validWindowCount: 3, p50Mbps: 100 }),
      stage({ streams: 2, aggregateMbps: 80, samples: [76, 80, 84], validWindowCount: 3, p50Mbps: 80 }),
    ];
    const selected = selectComparableCapacity(stages, "download", 900, 1_200, 2);

    expect(selected.publication.maximum.valueMbps).toBe(100);
    expect(selected.publication.reliable.valueMbps).toBe(98);
    const maximum = selected.publication.maximum.valueMbps;
    if (maximum === null) throw new Error("Expected a publishable maximum.");
    expect(selected.publication.reliable.valueMbps).toBeLessThanOrEqual(maximum);
  });

  it("does not publish a short single-stream stage that exceeds the qualified maximum", () => {
    const stages = [
      stage({ streams: 1, aggregateMbps: 900, medianMbps: 900, p50Mbps: 900, samples: [880, 900, 920], validWindowCount: 3, durationMs: 250 }),
      stage({ streams: 2, aggregateMbps: 300, medianMbps: 300, p50Mbps: 300, samples: [290, 300, 310], validWindowCount: 3, durationMs: 1_500 }),
    ];
    const selected = selectComparableCapacity(stages, "download", 900, 1_200, 2);

    expect(selected.publication.maximum.valueMbps).toBe(300);
    expect(selected.publication.singleStream).toMatchObject({
      status: "inconclusive",
      valueMbps: null,
    });
  });

  it("marks incomplete duration as a quick estimate", () => {
    const selected = selectComparableCapacity(
      [stage({ durationMs: 400, stopReason: "data-cap" })],
      "download",
      900,
      1_200,
      1,
    );
    expect(selected.publication.maximum.status).toBe("quick-estimate");
    expect(selected.publication.maximum.reasons.join(" ")).toMatch(/duration|data budget/i);
  });

  it("marks an exhausted data budget before the ramp completes as a quick estimate", () => {
    const selected = selectComparableCapacity(
      [stage({ streams: 1, durationMs: 1_500, stopReason: "data-cap" })],
      "download",
      900,
      1_200,
      2,
    );
    expect(selected.publication.maximum.status).toBe("quick-estimate");
    expect(selected.publication.maximum.reasons.join(" ")).toMatch(/data budget/i);
  });

  it("excludes an upload stage whose receipt does not match the submitted payload", () => {
    const receipt = diagnostic({
      direction: "upload",
      clientAttemptedBytes: 1_000,
      serverAcceptedBytes: 500,
      bytes: 500,
      uploadReceipt: {
        status: "mismatch",
        receiptId: "receipt-1",
        version: "1",
        testId: "test-run",
        stageId: "upload-1-1s",
        complete: true,
        attemptedBytes: 1_000,
        receivedBytes: 500,
        serverDurationMs: 100,
        disagreementBytes: 500,
        disagreementPct: 50,
        reasons: ["Server-received bytes differed from attempted bytes."],
      },
    });
    const selected = selectComparableCapacity(
      [stage({ requestBytes: 1_000, diagnostics: [receipt] })],
      "upload",
      900,
      1_200,
      1,
    );
    expect(selected.publication.maximum).toMatchObject({
      status: "inconclusive",
      valueMbps: null,
    });
    expect(selected.excludedReasons.join(" ")).toMatch(/upload receipt/i);
  });

  it("publishes the required low-confidence and quick-estimate labels", () => {
    const measured = directionCapacity("measured", 100);
    const quick = directionCapacity("quick-estimate", 25);
    const publication = buildResultPublication({
      confidence: { score: 59, summary: "Low confidence.", reasons: [] },
      download: measured,
      upload: quick,
    });
    expect(publication.labels).toEqual(["Low-confidence estimate.", "Quick estimate."]);
    expect(publication.accuracyCertified).toBe(false);
  });

  it("keeps unavailable throughput null instead of substituting zero", () => {
    const inconclusive = directionCapacity("inconclusive", null);
    const publication = buildResultPublication({
      confidence: { score: 80, summary: "Moderate confidence.", reasons: [] },
      download: inconclusive,
      upload: inconclusive,
    });
    expect(publication.download.valueMbps).toBeNull();
    expect(publication.upload.valueMbps).toBeNull();
    expect(publication.download.valueMbps).not.toBe(0);
    const partial: Partial<TestResult> = { publication };
    expect(METRICS.find((metric) => metric.id === "download")?.value(partial)).toBeNull();
    expect(METRICS.find((metric) => metric.id === "upload")?.value(partial)).toBeNull();
  });

  it("marks a missing valid maximum stage inconclusive", () => {
    const rejected = stage({
      aggregateMbps: 0,
      medianMbps: 0,
      p50Mbps: 0,
      bytes: 0,
      diagnostics: [diagnostic({ outcome: "failed", bytes: 0, failureReason: "endpoint interrupted" })],
      stopReason: "error",
      failedRequests: 1,
    });
    const selected = selectComparableCapacity([rejected], "download", 900, 1_200, 1);
    expect(selected.publication.maximum).toMatchObject({ status: "inconclusive", valueMbps: null });
  });

  it("does not qualify an unstable saturation burst as definitive maximum capacity", () => {
    const unstable = stage({
      streams: 4,
      rampState: "saturation",
      samples: [40, 300, 50, 280, 45],
      validWindowCount: 5,
      variationPct: 85,
      coefficientOfVariation: 0.85,
    });
    const selected = selectComparableCapacity([unstable], "download", 900, 1_200, 1, {
      minValidSamples: 3,
      maxVariationPct: 20,
    });
    expect(selected.publication.maximum.status).toBe("quick-estimate");
    expect(selected.maximum.qualification.reasons.join(" ")).toMatch(/variation/i);
  });

  it("keeps a reliable stage with insufficient duration as a quick estimate", () => {
    const selected = selectComparableCapacity(
      [stage({ durationMs: 500, samples: [95, 100, 105], validWindowCount: 3 })],
      "download",
      900,
      1_200,
      1,
    );
    expect(selected.publication.reliable.status).toBe("quick-estimate");
  });

  it("rejects a stage containing only aborted streams", () => {
    const aborted = stage({
      diagnostics: [diagnostic({ outcome: "aborted", failureReason: "Browser cancellation." })],
    });
    const selected = selectComparableCapacity([aborted], "download", 900, 1_200, 1);
    expect(selected.publication.maximum.status).toBe("inconclusive");
  });

  it("downgrades a stage measured while endpoint health is degraded", () => {
    const selected = selectComparableCapacity(
      [stage({ endpointHealth: "degraded" })],
      "download",
      900,
      1_200,
      1,
    );
    expect(selected.publication.maximum.status).toBe("quick-estimate");
    expect(selected.maximum.qualification.reasons.join(" ")).toMatch(/endpoint health/i);
  });

  it("rejects duplicate versioned upload receipts", () => {
    const receipt = {
      status: "verified" as const,
      receiptId: "duplicate-receipt",
      version: "1",
      testId: "test-run",
      stageId: "upload-1-1s",
      complete: true,
      attemptedBytes: 1_000,
      receivedBytes: 1_000,
      serverDurationMs: 100,
      disagreementBytes: 0,
      disagreementPct: 0,
      reasons: [],
    };
    const uploadStage = stage({
      stageId: "upload-1-1s",
      diagnostics: [
        diagnostic({ direction: "upload", clientAttemptedBytes: 1_000, serverAcceptedBytes: 1_000, uploadReceipt: receipt }),
        diagnostic({ direction: "upload", requestId: 1, clientAttemptedBytes: 1_000, serverAcceptedBytes: 1_000, uploadReceipt: receipt }),
      ],
    });
    const selected = selectComparableCapacity([uploadStage], "upload", 900, 1_200, 1);
    expect(selected.publication.maximum.status).toBe("inconclusive");
    expect(selected.excludedReasons.join(" ")).toMatch(/duplicate upload receipt/i);
  });
});

function stage(overrides: Partial<CapacityStage> = {}): CapacityStage {
  return {
    stageId: "download-1-1s",
    streams: 1,
    aggregateMbps: 100,
    medianMbps: 100,
    trimmedMeanMbps: 100,
    p5Mbps: 95,
    p50Mbps: 100,
    p95Mbps: 105,
    peakMbps: 110,
    variationPct: 5,
    coefficientOfVariation: 0.05,
    samples: [95, 105],
    validWindowCount: 2,
    bytes: 20_000_000,
    durationMs: 1_500,
    requestBytes: 1_000_000,
    failedRequests: 0,
    failedProbes: 0,
    improvementPct: null,
    stopReason: "duration",
    rampState: "baseline",
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
    diagnostics: [diagnostic()],
    ...overrides,
  };
}

function diagnostic(overrides: Partial<StreamDiagnostic> = {}): StreamDiagnostic {
  return {
    direction: "download",
    stage: "measurement",
    stageStreams: 1,
    streamId: 0,
    requestId: 0,
    endpoint: "https://example.test/down",
    startedAtMs: 0,
    responseAtMs: 10,
    firstByteAtMs: 12,
    endedAtMs: 100,
    timeToFirstByteMs: 10,
    transferDurationMs: 88,
    bytes: 1_000,
    transferMbps: 1,
    httpStatus: 200,
    protocol: "h2",
    cacheControl: "no-store",
    contentEncoding: null,
    contentLength: null,
    clientAttemptedBytes: 0,
    serverAcceptedBytes: null,
    serverReceiveDurationMs: null,
    uploadReceipt: null,
    outcome: "completed",
    failureReason: null,
    ...overrides,
  };
}

function directionCapacity(
  status: ThroughputPublicationStatus,
  valueMbps: number | null,
): DirectionCapacity {
  const rawValue = valueMbps ?? 100;
  const metric = { status, valueMbps, reasons: status === "inconclusive" ? ["Evidence unavailable."] : [] };
  const rawStage = stage({ aggregateMbps: rawValue });
  return {
    direction: "download",
    maximumMbps: rawValue,
    reliable: {
      status,
      mbps: rawValue,
      singleStreamMbps: rawValue,
      medianMbps: rawValue,
      p5Mbps: rawValue,
      p95Mbps: rawValue,
      peakMbps: rawValue,
      variationPct: 0,
      samples: [rawValue],
      sampleCount: 1,
      streams: 1,
      bytes: rawStage.bytes,
      durationMs: rawStage.durationMs,
      method: "test",
      limitation: null,
    },
    singleStreamMbps: rawValue,
    bytes: rawStage.bytes,
    warmupBytes: 1_000,
    durationMs: rawStage.durationMs,
    selectedStreams: 1,
    endpoint: "https://example.test/down",
    stages: [rawStage],
    diagnostics: [],
    rtts: [],
    failedRequests: 0,
    failedProbes: 0,
    warmupSucceeded: true,
    requestCompressionObserved: false,
    workerUsed: true,
    reducedConfidenceReasons: [],
    publication: {
      maximum: { ...metric },
      reliable: { ...metric },
      singleStream: { ...metric },
      comparisonBasis: "test",
      excludedStageCount: status === "inconclusive" ? 1 : 0,
      semanticConsistency: { valid: status !== "inconclusive", reasons: [] },
    },
  };
}
