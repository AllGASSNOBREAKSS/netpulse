import { describe, expect, it } from "vitest";
import { profileDataCeilingMB, PROFILES, resolveProfile } from "../profiles";

describe("measurement profile budgets", () => {
  it("keeps low-data mode inside its explicit application-payload ceiling", () => {
    expect(profileDataCeilingMB(true)).toBeLessThanOrEqual(40);
    expect(PROFILES.lowData.capacityDownload.ramp).toEqual([1, 2]);
    expect(PROFILES.lowData.capacityDownload.allowEarlyStatisticalStop).toBe(true);
  });

  it("admits that a gigabit low-data run cannot satisfy the full final-stage duration", () => {
    const profile = PROFILES.lowData.capacityDownload;
    const maximumPossibleMsAtOneGigabit = profile.maxBytes * 8 / 1_000_000_000 * 1_000;
    expect(maximumPossibleMsAtOneGigabit).toBeLessThan(profile.finalStageMinMs);
  });

  it("reserves a hard ceiling capable of a five-second 2.5 Gbps final stage", () => {
    const profile = PROFILES.full.capacityDownload;
    const finalBudget = (profile.maxBytes - profile.warmupBytes) * 0.65;
    const required = 2_500_000_000 / 8 * (profile.finalStageMinMs / 1_000);
    expect(finalBudget).toBeGreaterThanOrEqual(required);
  });

  it("keeps the hard data ceiling distinct from typical expected use", () => {
    expect(profileDataCeilingMB(false, "full")).toBeGreaterThan(PROFILES.full.estimatedDataMB);
  });

  it("selects full by default and never applies quick mode heuristically", () => {
    expect(resolveProfile(undefined, false)).toBe(PROFILES.full);
    expect(resolveProfile(undefined, true)).toBe(PROFILES.lowData);
    expect(resolveProfile("quick", false)).toBe(PROFILES.quick);
  });
});
