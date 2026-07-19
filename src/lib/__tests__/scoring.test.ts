import { describe, expect, it } from "vitest";
import { computeScore } from "../scoring";
import type { TestResult } from "../types";

/** Minimal fixture — scoring only reads the mirror fields below. */
function fixture(over: Partial<TestResult>): TestResult {
  return {
    downloadMbps: 300,
    uploadMbps: 50,
    idlePingMs: 10,
    idleJitterMs: 2,
    bufferbloatGrade: "A",
    bufferbloatMs: 10,
    spikes: 0,
    probeCount: 20,
    ...over,
  } as TestResult;
}

describe("health score", () => {
  it("weights sum to 100 across components", () => {
    const { parts } = computeScore(fixture({}));
    expect(parts.reduce((s, p) => s + p.weight, 0)).toBe(100);
  });

  it("a fast, low-latency, no-bloat connection scores near the top", () => {
    const { total } = computeScore(fixture({ downloadMbps: 500, uploadMbps: 60, idlePingMs: 8 }));
    expect(total).toBeGreaterThan(92);
  });

  it("a slow connection scores low", () => {
    const { total } = computeScore(
      fixture({ downloadMbps: 4, uploadMbps: 1, idlePingMs: 40, bufferbloatGrade: "B", bufferbloatMs: 45 }),
    );
    expect(total).toBeLessThan(55);
  });

  it("high latency alone drags a fast link down", () => {
    const fast = computeScore(fixture({ idlePingMs: 8 })).total;
    const laggy = computeScore(fixture({ idlePingMs: 120 })).total;
    expect(laggy).toBeLessThan(fast);
  });

  it("bufferbloat F zeroes its 24-point component vs grade A", () => {
    const a = computeScore(fixture({ bufferbloatGrade: "A" }));
    const f = computeScore(fixture({ bufferbloatGrade: "F" }));
    const aBloat = a.parts.find((p) => p.id === "bufferbloat")!.earned;
    const fBloat = f.parts.find((p) => p.id === "bufferbloat")!.earned;
    expect(aBloat).toBeCloseTo(24, 1);
    expect(fBloat).toBe(0);
  });

  it("each earned value never exceeds its weight", () => {
    const { parts } = computeScore(fixture({ downloadMbps: 99999, uploadMbps: 99999 }));
    for (const p of parts) expect(p.earned).toBeLessThanOrEqual(p.weight + 0.05);
  });
});
