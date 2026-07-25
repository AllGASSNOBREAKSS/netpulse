import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "../history";
import { assessHistoricalMetric, compareIspHistory } from "../historicalIntelligence";

function entry(ts: number, down: number): HistoryEntry {
  return { ts, down, up: 20, ping: 20, bloat: 10, grade: "A", score: 90, dataMB: 10 };
}

describe("historical intelligence", () => {
  it("does not assert a baseline before enough local measurements exist", () => {
    const result = assessHistoricalMetric([entry(1, 100), entry(2, 98)], "down", 40);
    expect(result.baselineMedian).toBeNull();
    expect(result.confirmed).toBe(false);
  });

  it("requires repeated degradation before confirming a change", () => {
    const stable = Array.from({ length: 10 }, (_, index) => entry(index, 100));
    const first = assessHistoricalMetric(stable, "down", 50);
    expect(first.degraded).toBe(true);
    expect(first.confirmed).toBe(false);

    const recentDrops = [entry(20, 45), entry(19, 48), ...stable];
    const repeated = assessHistoricalMetric(recentDrops, "down", 50);
    expect(repeated.degraded).toBe(true);
    expect(repeated.confirmed).toBe(true);
  });
});

describe("ISP history comparison", () => {
  it("uses only named ISP groups with enough real saved runs", () => {
    const entries = [
      entry(1, 100), entry(2, 110), entry(3, 90),
      { ...entry(4, 200), isp: "Other ISP" },
    ].map((entry, index) => ({ ...entry, isp: index < 3 ? "Example ISP" : entry.isp }));
    const result = compareIspHistory(entries, 3);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ isp: "Example ISP", sampleCount: 3, medianDownloadMbps: 100 });
  });
});
