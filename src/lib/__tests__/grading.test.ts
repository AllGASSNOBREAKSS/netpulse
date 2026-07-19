import { describe, expect, it } from "vitest";
import { bloatGrade, computeBufferbloat, computeStability } from "../grading";
import { summarize } from "../stats";

describe("bufferbloat grading", () => {
  it("pins the documented boundaries", () => {
    expect(bloatGrade(0)).toBe("A");
    expect(bloatGrade(29)).toBe("A");
    expect(bloatGrade(30)).toBe("B");
    expect(bloatGrade(59)).toBe("B");
    expect(bloatGrade(60)).toBe("C");
    expect(bloatGrade(99)).toBe("C");
    expect(bloatGrade(100)).toBe("D");
    expect(bloatGrade(199)).toBe("D");
    expect(bloatGrade(200)).toBe("F");
    expect(bloatGrade(5000)).toBe("F");
  });

  it("keeps download and upload separate and takes the worse overall", () => {
    const idle = summarize([20, 20, 20, 20]);
    const loadedDown = summarize([35, 35, 35]); // +15 → A
    const loadedUp = summarize([140, 140, 140]); // +120 → D
    const b = computeBufferbloat(idle, loadedDown, loadedUp);
    expect(b.downloadGrade).toBe("A");
    expect(b.uploadGrade).toBe("D");
    expect(b.overallGrade).toBe("D");
    expect(b.uploadMs).toBeCloseTo(120, 0);
  });

  it("never reports negative rise (loaded faster than idle)", () => {
    const idle = summarize([50, 50, 50]);
    const faster = summarize([30, 30, 30]);
    const b = computeBufferbloat(idle, faster, faster);
    expect(b.downloadMs).toBe(0);
  });
});

describe("stability score", () => {
  it("scores a steady connection high", () => {
    const steady = Array.from({ length: 30 }, () => 22 + Math.sin(Math.random()));
    const s = computeStability(20, steady, 0.03);
    expect(s.score).toBeGreaterThan(85);
    expect(s.spikes).toBe(0);
  });

  it("scores a spiky/high-jitter connection low and counts spikes", () => {
    const spiky = [20, 22, 21, 400, 23, 500, 22, 380, 21, 20];
    const s = computeStability(20, spiky, 0.35);
    expect(s.spikes).toBeGreaterThanOrEqual(3);
    expect(s.longestSpikeMs).toBeGreaterThanOrEqual(500);
    expect(s.score).toBeLessThan(60);
  });
});
