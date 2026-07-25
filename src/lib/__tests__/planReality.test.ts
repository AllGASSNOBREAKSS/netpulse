import { describe, expect, it } from "vitest";
import { createPlanRealityReport, evaluatePlanReality, type PlanProfile } from "../planReality";
import type { HistoryEntry } from "../history";

const PROFILE: PlanProfile = { isp: "Example ISP", planName: "500", advertisedDownloadMbps: 500, advertisedUploadMbps: 100, monthlyPrice: 70, dataAllowanceGb: null, connectionType: "Fiber" };

describe("ISP Plan Reality Check", () => {
  it("excludes low-confidence and invalid history instead of substituting values", () => {
    const result = evaluatePlanReality(PROFILE, [entry(1, 400, 80, 64), { ...entry(2, 400, 80, 90), down: 0 }, entry(3, 450, 90, 90)]);
    expect(result.validTests).toHaveLength(1);
    expect(result.excludedLowConfidence).toBe(1);
    expect(result.excludedInvalid).toBe(1);
    expect(result.medianDownloadMbps).toBe(450);
  });

  it("uses medians and user-supplied access-medium labels transparently", () => {
    const history = [
      entry(Date.UTC(2026, 6, 19, 19), 300, 80, 90, "wifi"),
      entry(Date.UTC(2026, 6, 20, 20), 320, 82, 90, "wifi"),
      entry(Date.UTC(2026, 6, 19, 10), 480, 95, 90, "ethernet"),
      entry(Date.UTC(2026, 6, 20, 11), 500, 97, 90, "ethernet"),
    ];
    const result = evaluatePlanReality(PROFILE, history);
    expect(result.medianDownloadMbps).toBe(400);
    expect(result.deliveredDownloadPct).toBe(80);
    expect(result.peakHourMedianMbps).toBe(310);
    expect(result.offPeakMedianMbps).toBe(490);
    expect(result.wifiMedianMbps).toBe(310);
    expect(result.wiredMedianMbps).toBe(490);
    expect(result.wifiVsWiredDifferencePct).toBeCloseTo(36.73, 1);
  });

  it("calculates loaded-latency rise and labels reliability as non-contractual", () => {
    const history = [entry(1, 400, 80, 90), entry(2, 410, 82, 90)];
    const result = evaluatePlanReality(PROFILE, history);
    expect(result.loadedDownRiseMs).toBe(40);
    expect(result.loadedUpRiseMs).toBe(80);
    expect(result.reliabilityScore).toBeGreaterThanOrEqual(0);
    expect(result.reliabilityScore).toBeLessThanOrEqual(100);
    expect(result.reliabilityFormula).toMatch(/not uptime or contractual compliance/i);
    expect(createPlanRealityReport(PROFILE, result)).toMatch(/does not determine contract compliance/i);
  });
});

function entry(ts: number, down: number, up: number, confidence: number, connectionMedium: HistoryEntry["connectionMedium"] = "unknown"): HistoryEntry {
  return { ts, down, up, ping: 20, bloat: 80, grade: "B", score: 80, dataMB: 50, confidence, loadedDownMs: 60, loadedUpMs: 100, stabilityScore: 85, durationMs: 20_000, connectionMedium, timezoneOffsetMinutes: 0 };
}
