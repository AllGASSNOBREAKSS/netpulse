import { describe, expect, it } from "vitest";
import { applicationMbps, capacityStageBudgetWeights, measureCapacity } from "../capacityCore";
import type { CapacityPlan } from "../capacityProtocol";

const plan: CapacityPlan = {
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
  stageMinMs: 500,
  stageMaxMs: 700,
  finalStageMinMs: 800,
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
    expect(capacityStageBudgetWeights(3)).toEqual([1 / 3, 1 / 3, 1 / 3]);
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

  it("uses the upload endpoint receipt and rejects compressed measurement responses", async () => {
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
      expect(measured.reliable.sampleCount).toBeGreaterThanOrEqual(2);
      expect(measured.failedProbes).toBe(0);
      compressed = true;
      await expect(measureCapacity(uploadPlan, {}, new AbortController().signal)).rejects.toThrow(
        "capacity stage transferred no usable data",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
