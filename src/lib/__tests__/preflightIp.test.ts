import { describe, expect, it } from "vitest";
import { compareIpFamilies } from "../preflight";
import type { IpFamilySample } from "../types";

function sample(medianMs: number | null): IpFamilySample {
  return {
    status: medianMs === null ? "unknown" : "yes",
    medianMs,
    p95Ms: medianMs,
    jitterMs: medianMs === null ? null : 1,
    successful: medianMs === null ? 0 : 3,
    failed: medianMs === null ? 3 : 0,
    method: "test",
  };
}

describe("IPv4 / IPv6 comparison", () => {
  it("selects the lower-latency family only when the difference is meaningful", () => {
    expect(compareIpFamilies(sample(20), sample(35)).preferred).toBe("IPv4");
    expect(compareIpFamilies(sample(20), sample(22)).preferred).toBe("similar");
  });

  it("remains unavailable when either family has no timing evidence", () => {
    expect(compareIpFamilies(sample(20), sample(null))).toMatchObject({ preferred: "unavailable", differenceMs: null });
  });
});
