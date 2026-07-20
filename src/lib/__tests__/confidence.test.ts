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
});
