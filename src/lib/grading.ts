/**
 * Grading logic for bufferbloat and stability. Pure functions with documented
 * thresholds so the UI can explain *why* a grade was assigned, and so unit
 * tests can pin the boundaries.
 */
import { percentile, stddev } from "./stats";
import type { BloatGrade, Bufferbloat, Stability, Summary } from "./types";

/** Latency increase (ms) → letter grade. Thresholds are documented in-app. */
export function bloatGrade(riseMs: number): BloatGrade {
  if (riseMs < 30) return "A";
  if (riseMs < 60) return "B";
  if (riseMs < 100) return "C";
  if (riseMs < 200) return "D";
  return "F";
}

const worse = (a: BloatGrade, b: BloatGrade): BloatGrade => (a >= b ? a : b);

export const BLOAT_FORMULA =
  "rise = median(loaded latency) − median(idle latency), computed separately for download and upload. Grade: A <30ms, B <60ms, C <100ms, D <200ms, F ≥200ms. Overall grade is the worse of the two.";

export function computeBufferbloat(idle: Summary, loadedDown: Summary, loadedUp: Summary): Bufferbloat {
  const downloadMs = Math.max(0, loadedDown.median - idle.median);
  const uploadMs = Math.max(0, loadedUp.median - idle.median);
  const downloadGrade = bloatGrade(downloadMs);
  const uploadGrade = bloatGrade(uploadMs);
  return {
    downloadMs,
    uploadMs,
    downloadGrade,
    uploadGrade,
    overallGrade: worse(downloadGrade, uploadGrade),
    formula: BLOAT_FORMULA,
  };
}

/**
 * Stability score (0–100) from the full set of loaded-latency probes and the
 * download throughput samples. Penalizes spread (stddev), spikes, and
 * throughput variation.
 */
export function computeStability(
  idleMedian: number,
  loadedRtts: number[],
  downloadCov: number,
  uploadCov = 0,
): Stability {
  const sd = stddev(loadedRtts);
  const p95 = percentile(loadedRtts, 95);
  const p99 = percentile(loadedRtts, 99);
  const spikeThreshold = Math.max(idleMedian * 3, idleMedian + 150);
  const spikeVals = loadedRtts.filter((r) => r > spikeThreshold);
  const spikes = spikeVals.length;
  const longestSpikeMs = spikeVals.length ? Math.round(Math.max(...spikeVals)) : 0;

  // Each factor contributes a 0–1 penalty.
  const spreadPenalty = Math.min(sd / 100, 1); // 100ms stddev = full penalty
  const spikeRatio = loadedRtts.length ? spikes / loadedRtts.length : 0;
  const spikePenalty = Math.min(spikeRatio * 4, 1);
  const throughputCov = Math.max(downloadCov, uploadCov);
  const covPenalty = Math.min(throughputCov / 0.4, 1); // CoV 0.4 = full penalty

  const score = Math.round(100 * (1 - (spreadPenalty * 0.4 + spikePenalty * 0.4 + covPenalty * 0.2)));

  return {
    score: Math.max(0, score),
    latencyStddevMs: Math.round(sd * 10) / 10,
    p95Ms: Math.round(p95),
    p99Ms: Math.round(p99),
    spikes,
    longestSpikeMs,
    throughputCov: Math.round(throughputCov * 1000) / 1000,
  };
}
