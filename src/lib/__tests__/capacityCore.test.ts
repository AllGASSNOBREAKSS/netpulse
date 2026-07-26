import { describe, expect, it, vi } from "vitest";
import { applicationMbps, capacityStageBudgetWeights, measureCapacity, runCapacityStage } from "../capacityCore";
import type { CapacityPlan } from "../capacityProtocol";

const plan: CapacityPlan = {
  runId: "test-run",
  direction: "download",
  downloadUrlTemplate: "https://example.test/down?bytes={bytes}",
  uploadUrl: "https://example.test/up",
  latencyUrl: "https://example.test/down?bytes=0",
  endpoint: "https://example.test/down",
  streamRamp: [1, 2, 4],
  maxDurationMs: 2_000,
  maxBytes: 12_000,
  maxRequestBytes: 2_000,
  warmupBytes: 1_000,
  setupTimeoutMs: 1_000,
  stageMinMs: 500,
  stageMaxMs: 700,
  finalStageMinMs: 800,
  stageMinBytes: 1,
  minValidSamples: 1,
  maxVariationPct: 100,
  receiptTolerancePct: 0.5,
  receiptToleranceBytes: 1,
  profileMode: "full",
  endpointHealth: "healthy",
  allowEarlyStatisticalStop: false,
  improvementThresholdPct: 5,
  progressIntervalMs: 100,
  latencyProbeIntervalMs: 500,
};

describe("capacity measurement accounting", () => {
  it("converts application bytes and monotonic milliseconds to decimal Mbps", () => {
    expect(applicationMbps(1_000_000, 64)).toBe(125);
    expect(applicationMbps(0, 64)).toBe(0);
    expect(applicationMbps(1_000, 0)).toBe(0);
  });

  it("reserves enough of a five-stage budget for a stable high-speed final stage", () => {
    const weights = capacityStageBudgetWeights(5);
    expect(weights).toEqual([0.03, 0.04, 0.18, 0.1, 0.65]);
    expect(weights.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
    expect(capacityStageBudgetWeights(3)).toEqual([0.15, 0.25, 0.6]);
    expect(capacityStageBudgetWeights(2, "lowData")).toEqual([0.25, 0.75]);
  });

  it("records every configured ramp stage when short byte-capped stages cannot prove saturation", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const bytes = Number(url.searchParams.get("bytes") ?? 0);
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: {
          "cache-control": "no-store, no-transform",
          "content-length": String(bytes),
        },
      });
    }) as typeof fetch;
    try {
      const result = await measureCapacity(plan, {}, new AbortController().signal);
      expect(result.stages.map((stage) => stage.streams)).toEqual([1, 2, 4]);
      expect(result.diagnostics.every((item) => item.endpoint === "https://example.test/down")).toBe(true);
      expect(result.diagnostics.some((item) => item.stageStreams === 4)).toBe(true);
      expect(result.bytes).toBeGreaterThan(0);
      expect(result.maximumMbps).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("uses the upload endpoint receipt without treating acknowledgement encoding as lost upload data", async () => {
    const originalFetch = globalThis.fetch;
    const uploadPlan: CapacityPlan = {
      ...plan,
      direction: "upload",
      streamRamp: [1],
      maxBytes: 4_000,
      warmupBytes: 500,
      maxRequestBytes: 1_000,
    };
    let compressed = false;
    globalThis.fetch = (async () => {
      const bytes = compressed ? 0 : 1_000;
      return new Response(null, {
        status: 200,
        headers: compressed
          ? { "content-encoding": "gzip" }
          : { "cf-meta-upload-bytes": String(bytes) },
      });
    }) as typeof fetch;
    try {
      const measured = await measureCapacity(uploadPlan, {}, new AbortController().signal);
      expect(measured.diagnostics.some((item) => item.serverAcceptedBytes === 1_000)).toBe(true);
      expect(measured.reliable.sampleCount).toBeGreaterThanOrEqual(1);
      expect(measured.reliable.status).toBe("quick-estimate");
      expect(measured.failedProbes).toBe(0);
      compressed = true;
      const encodedAcknowledgement = await measureCapacity(uploadPlan, {}, new AbortController().signal);
      expect(encodedAcknowledgement.publication.maximum.status).toBe("quick-estimate");
      expect(encodedAcknowledgement.publication.maximum.valueMbps).toBeGreaterThan(0);
      expect(encodedAcknowledgement.diagnostics.some((item) => item.contentEncoding === "gzip")).toBe(true);
      expect(encodedAcknowledgement.diagnostics.some((item) => item.failureClassification === "compressed-response-rejected")).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("reads content-encoded download bytes but limits them to a quick estimate", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const bytes = Number(url.searchParams.get("bytes") ?? 0);
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: {
          "cache-control": "no-store",
          "content-encoding": "gzip",
        },
      });
    }) as typeof fetch;
    try {
      const measured = await measureCapacity(
        { ...plan, streamRamp: [1], maxBytes: 4_000, maxRequestBytes: 1_000, warmupBytes: 500 },
        {},
        new AbortController().signal,
      );
      expect(measured.bytes).toBeGreaterThan(0);
      expect(measured.stages[0].bytes).toBeGreaterThan(0);
      expect(measured.stages[0].qualification.compressionQualified).toBe(false);
      expect(measured.publication.maximum.status).toBe("quick-estimate");
      expect(measured.publication.maximum.valueMbps).toBeGreaterThan(0);
      expect(measured.diagnostics.some((item) => item.failureClassification === "compressed-response-rejected")).toBe(false);
      expect(measured.reducedConfidenceReasons).toContain(
        "A response reported content encoding; application byte accounting may not represent wire bytes.",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("still rejects an encoded download whose completed decoded bytes do not match the request", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const bytes = Number(url.searchParams.get("bytes") ?? 0);
      return new Response(new Uint8Array(Math.max(0, bytes - 1)), {
        status: 200,
        headers: {
          "cache-control": "no-store",
          "content-encoding": "gzip",
        },
      });
    }) as typeof fetch;
    try {
      const rejected = await measureCapacity(
        { ...plan, streamRamp: [1], maxBytes: 4_000, maxRequestBytes: 1_000, warmupBytes: 500 },
        {},
        new AbortController().signal,
      );
      expect(rejected.publication.maximum).toMatchObject({ status: "inconclusive", valueMbps: null });
      expect(rejected.publication.reliable).toMatchObject({ status: "inconclusive", valueMbps: null });
      expect(rejected.stages[0].qualification.reasons).toContain("Completed download bytes did not match Content-Length.");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("excludes a three-second TTFB from the measured download window", async () => {
    const originalFetch = globalThis.fetch;
    vi.useFakeTimers();
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const bytes = Number(url.searchParams.get("bytes") ?? 0);
      if (bytes === 0) return new Response(new Uint8Array(), { status: 200 });
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: { "cache-control": "no-store", "content-length": String(bytes) },
      });
    }) as typeof fetch;
    try {
      const stagePromise = runCapacityStage(
        { ...plan, setupTimeoutMs: 5_000 },
        "download-timing",
        1,
        500,
        100,
        1_000,
        1_000,
        {},
        new AbortController().signal,
      );
      await vi.advanceTimersByTimeAsync(3_000);
      const stage = await stagePromise;
      expect(stage.bytes).toBe(1_000);
      expect(stage.measurementStartedAtMs).not.toBeNull();
      expect(stage.wallClockDurationMs! - stage.durationMs).toBeGreaterThanOrEqual(2_990);
      expect(stage.firstPayloadAtMs!).toBeGreaterThanOrEqual(stage.firstResponseAtMs!);
    } finally {
      globalThis.fetch = originalFetch;
      vi.useRealTimers();
    }
  });

  it("classifies endpoint setup timeout without publishing a numeric result", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      })) as typeof fetch;
    try {
      const stage = await runCapacityStage(
        { ...plan, setupTimeoutMs: 20 },
        "download-timeout",
        1,
        100,
        50,
        1_000,
        1_000,
        {},
        new AbortController().signal,
      );
      expect(stage.stopReason).toBe("setup-timeout");
      expect(stage.bytes).toBe(0);
      expect(stage.diagnostics.some((item) => item.failureClassification === "endpoint-setup-timeout")).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("retries a zero-byte stage once with reduced request size", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const bytes = Number(url.searchParams.get("bytes") ?? 0);
      const stageId = url.searchParams.get("np_stage_id") ?? "";
      if (stageId.includes("-1-1s") && !stageId.includes("-retry")) {
        return new Response(new Uint8Array(), { status: 200, headers: { "cache-control": "no-store" } });
      }
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: { "cache-control": "no-store", "content-length": String(bytes) },
      });
    }) as typeof fetch;
    try {
      const result = await measureCapacity(
        { ...plan, streamRamp: [1], maxBytes: 9_000_000, maxRequestBytes: 32_000_000, warmupBytes: 500 },
        {},
        new AbortController().signal,
      );
      expect(result.stages).toHaveLength(1);
      expect(result.stages[0].retryAttempt).toBe(1);
      expect(result.stages[0].recoveredFromFailure).toBe(true);
      expect(result.stages[0].requestBytes).toBeLessThanOrEqual(8_000_000);
      expect(result.stages[0].diagnostics.some((item) => item.failureClassification === "response-body-empty")).toBe(true);
      expect(result.publication.maximum.valueMbps).not.toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("preserves earlier usable evidence when a later ramp stage fails", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const bytes = Number(url.searchParams.get("bytes") ?? 0);
      const stageId = url.searchParams.get("np_stage_id") ?? "";
      if (stageId.includes("-2-2s")) {
        return new Response(new Uint8Array(), { status: 200, headers: { "cache-control": "no-store" } });
      }
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: { "cache-control": "no-store", "content-length": String(bytes) },
      });
    }) as typeof fetch;
    try {
      const result = await measureCapacity(
        { ...plan, streamRamp: [1, 2], maxBytes: 8_000, maxRequestBytes: 2_000, warmupBytes: 500 },
        {},
        new AbortController().signal,
      );
      expect(result.stages).toHaveLength(2);
      expect(result.stages[0].bytes).toBeGreaterThan(0);
      expect(result.stages[1].bytes).toBe(0);
      expect(result.publication.maximum.valueMbps).not.toBeNull();
      expect(result.publication.maximum.status).toBe("quick-estimate");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it.each([
    {
      name: "HTTP rejection",
      response: () => new Response(null, { status: 503 }),
      classification: "endpoint-http-error",
    },
    {
      name: "missing response body",
      response: () => new Response(null, { status: 200, headers: { "cache-control": "no-store" } }),
      classification: "response-body-unavailable",
    },
  ] as const)("classifies $name without inventing bytes", async ({ response, classification }) => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => response()) as typeof fetch;
    try {
      const stage = await runCapacityStage(
        { ...plan, setupTimeoutMs: 100 },
        `download-${classification}`,
        1,
        100,
        50,
        1_000,
        1_000,
        {},
        new AbortController().signal,
      );
      expect(stage.bytes).toBe(0);
      expect(stage.diagnostics.some((item) => item.failureClassification === classification)).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
