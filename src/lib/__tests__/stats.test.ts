import { describe, expect, it } from "vitest";
import { jitter, mean, median, percentile, stddev, summarize, topHalfMedian } from "../stats";

describe("stats", () => {
  it("median handles odd and even lengths", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  it("percentile interpolates and pins the ends", () => {
    const xs = [10, 20, 30, 40, 50];
    expect(percentile(xs, 0)).toBe(10);
    expect(percentile(xs, 100)).toBe(50);
    expect(percentile(xs, 50)).toBe(30);
    expect(percentile([5], 95)).toBe(5); // single sample
  });

  it("mean and stddev on a known set", () => {
    expect(mean([2, 4, 6])).toBe(4);
    expect(stddev([2, 4, 6])).toBeCloseTo(2, 5);
    expect(stddev([7])).toBe(0);
  });

  it("jitter is mean absolute consecutive delta", () => {
    expect(jitter([10, 12, 11, 13])).toBeCloseTo((2 + 1 + 2) / 3, 5);
    expect(jitter([5])).toBe(0);
  });

  it("topHalfMedian ignores the slow ramp-up half", () => {
    // ramp-up 1..5 then steady ~100 → representative should be ~100, not ~50
    const samples = [1, 2, 3, 4, 5, 98, 100, 102, 99, 101];
    expect(topHalfMedian(samples)).toBeGreaterThan(95);
  });

  it("summarize reports p95/p99 and count", () => {
    const s = summarize([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(s.count).toBe(10);
    expect(s.min).toBe(10);
    expect(s.p95).toBeGreaterThan(90);
    expect(s.p99).toBeGreaterThan(s.p95 - 1);
  });
});
