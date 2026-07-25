import { describe, expect, it } from "vitest";
import {
  PHASE_2_CONTROLLED_IMPAIRMENTS,
  PHASE_2_LATENCY_PROFILES_MS,
  PHASE_2_SPEED_TIERS_MBPS,
  runPhase2DeterministicTrials,
  summarizePhase2DeterministicTrials,
} from "../phase2Validation";

describe("Phase 2 deterministic semantic validation", () => {
  const trials = runPhase2DeterministicTrials(20);
  const summaries = summarizePhase2DeterministicTrials(trials);

  it("executes twenty deterministic trials for every required speed tier", () => {
    expect(PHASE_2_SPEED_TIERS_MBPS).toEqual([10, 25, 50, 100, 300, 500, 1_000, 2_500]);
    expect(trials).toHaveLength(PHASE_2_SPEED_TIERS_MBPS.length * 20);
    expect(summaries.every((summary) => summary.trials === 20)).toBe(true);
  });

  it("preserves maximum >= reliable and maximum >= single-stream in every complete trial", () => {
    for (const trial of trials) {
      expect(trial.status).toBe("complete");
      expect(trial.maximumMbps).not.toBeNull();
      expect(trial.reliableMbps).not.toBeNull();
      expect(trial.singleStreamMbps).not.toBeNull();
      if (trial.maximumMbps === null || trial.reliableMbps === null || trial.singleStreamMbps === null) continue;
      expect(trial.maximumMbps).toBeGreaterThanOrEqual(trial.reliableMbps);
      expect(trial.maximumMbps).toBeGreaterThanOrEqual(trial.singleStreamMbps);
    }
  });

  it("keeps deterministic selection error and repeatability inside the semantic-harness gate", () => {
    for (const summary of summaries) {
      expect(summary.medianAbsoluteErrorPct).not.toBeNull();
      expect(summary.p95ErrorPct).not.toBeNull();
      expect(summary.coefficientOfVariationPct).not.toBeNull();
      expect(summary.medianAbsoluteErrorPct ?? Infinity).toBeLessThan(2);
      expect(summary.p95ErrorPct ?? Infinity).toBeLessThanOrEqual(5);
      expect(summary.coefficientOfVariationPct ?? Infinity).toBeLessThan(3);
      expect(summary.failureRatePct).toBe(0);
      expect(summary.inconclusiveRatePct).toBe(0);
    }
  });

  it("declares the controlled latency and impairment matrix without treating it as executed", () => {
    expect(PHASE_2_LATENCY_PROFILES_MS).toEqual([5, 20, 50, 100]);
    expect(PHASE_2_CONTROLLED_IMPAIRMENTS).toContain("endpoint-interruption");
    expect(PHASE_2_CONTROLLED_IMPAIRMENTS).toContain("browser-cancellation");
    expect(PHASE_2_CONTROLLED_IMPAIRMENTS).toContain("background-tab");
  });
});
