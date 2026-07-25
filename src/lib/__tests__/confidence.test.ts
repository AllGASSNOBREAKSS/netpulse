import { describe, expect, it } from "vitest";
import { computeConfidence, type ConfidenceInputs } from "../confidence";

const base: ConfidenceInputs = {
  downloadSamples: Array.from({ length: 24 }, (_, i) => 300 + Math.sin(i) * 2),
  uploadSamples: [40, 45, 48, 49, 50],
  idleProbeCount: 14,
  idleFailed: 0,
  loadedDownProbeCount: 10,
  loadedUpProbeCount: 10,
  serverAvailable: true,
  serverJitterMs: 4,
  downloadWarmupSucceeded: true,
  uploadWarmupSucceeded: true,
  downloadMinimumDurationMet: true,
  uploadMinimumDurationMet: true,
  tabForegroundThroughout: true,
  completed: true,
  errors: 0,
  earlyStopped: false,
};

describe("result confidence", () => {
  it("a clean foreground full run is high confidence", () => {
    const c = computeConfidence(base);
    expect(c.score).toBeGreaterThanOrEqual(85);
    expect(c.summary.toLowerCase()).toContain("high");
  });

  it("a backgrounded tab is heavily penalized (throttling risk)", () => {
    const c = computeConfidence({ ...base, tabForegroundThroughout: false });
    expect(c.score).toBeLessThan(base.downloadSamples.length ? 90 : 100);
    expect(c.reasons.find((r) => r.label === "Tab visibility")?.ok).toBe(false);
  });

  it("an incomplete/interrupted test drops sharply", () => {
    const c = computeConfidence({ ...base, completed: false });
    expect(c.score).toBeLessThan(75);
    expect(c.reasons.find((r) => r.label === "Completion")?.ok).toBe(false);
  });

  it("few, variable samples lower confidence", () => {
    const c = computeConfidence({
      ...base,
      downloadSamples: [10, 300, 40, 280, 30], // few + wildly variable
    });
    expect(c.score).toBeLessThan(base.downloadSamples.length ? 90 : 100);
    expect(c.reasons.find((r) => r.label === "Download sampling")?.ok).toBe(false);
  });

  it("failed probes and unstable server are reflected", () => {
    const c = computeConfidence({ ...base, idleFailed: 3, serverJitterMs: 40, serverAvailable: true });
    expect(c.reasons.find((r) => r.label === "Measurement errors")?.ok).toBe(false);
    expect(c.reasons.find((r) => r.label === "Server stability")?.ok).toBe(false);
  });

  it("does not treat missing loaded-latency probes as trustworthy", () => {
    const c = computeConfidence({ ...base, loadedDownProbeCount: 0 });
    expect(c.score).toBeLessThan(85);
    expect(c.reasons.find((r) => r.label === "Download-loaded latency")?.ok).toBe(false);
  });

  it("does not call a single throughput sample consistent", () => {
    const c = computeConfidence({ ...base, downloadSamples: [300] });
    expect(c.reasons.find((r) => r.label === "Download consistency")?.ok).toBe(false);
  });

  it("shows the exact penalty applied for a weak factor", () => {
    const c = computeConfidence({ ...base, uploadSamples: [20] });
    expect(c.reasons.find((r) => r.label === "Upload sampling")?.penalty).toBe(6);
  });

  it("does not treat one upload observation as a variation estimate", () => {
    const c = computeConfidence({ ...base, uploadSamples: [20] });
    expect(c.reasons.find((r) => r.label === "Upload consistency")?.ok).toBe(false);
  });

  it("reports failed transfer warm-ups", () => {
    const c = computeConfidence({ ...base, downloadWarmupSucceeded: false });
    expect(c.reasons.find((r) => r.label === "Download warm-up")?.penalty).toBe(4);
  });

  it("caps low-data confidence even when the reduced run is otherwise clean", () => {
    const c = computeConfidence({ ...base, profileMode: "lowData" });
    expect(c.score).toBeLessThanOrEqual(65);
    expect(c.reasons.find((r) => r.label === "Profile confidence ceiling")?.ok).toBe(false);
  });

  it("penalizes quick estimates and inconclusive metric evidence", () => {
    const quick = computeConfidence({ ...base, downloadPublication: "quick-estimate" });
    const inconclusive = computeConfidence({ ...base, downloadPublication: "inconclusive" });
    expect(quick.score).toBeLessThan(computeConfidence(base).score);
    expect(inconclusive.score).toBeLessThan(quick.score);
  });

  it("penalizes upload receipt disagreement more than partial receipt identity", () => {
    const partial = computeConfidence({ ...base, uploadReceiptStatus: "partial" });
    const mismatch = computeConfidence({ ...base, uploadReceiptStatus: "mismatch" });
    expect(mismatch.score).toBeLessThan(partial.score);
    expect(mismatch.reasons.find((r) => r.label === "Upload receipt")?.penalty).toBe(25);
  });

  it("penalizes semantic inversion and phase retries", () => {
    const c = computeConfidence({ ...base, semanticConsistency: false, phaseRetryCount: 1 });
    expect(c.reasons.find((r) => r.label === "Metric semantics")?.penalty).toBe(25);
    expect(c.reasons.find((r) => r.label === "Phase retry")?.penalty).toBe(6);
  });
});
