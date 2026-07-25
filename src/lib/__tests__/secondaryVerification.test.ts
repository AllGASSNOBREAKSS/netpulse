import { describe, expect, it } from "vitest";
import { latencyOnlySecondary, unavailableSecondary } from "../secondaryVerification";
import { summarize } from "../stats";
import type { ServerSelection } from "../types";

const backup = {
  id: "backup",
  provider: "Independent",
  regionId: "backup-region",
  regionLabel: "Backup region",
  edgeCode: null,
  clientCountryCode: null,
  city: null,
  region: "Backup region",
  approximateDistanceKm: null,
  protocol: "HTTPS",
  ipFamily: "IPv4" as const,
  latency: summarize([20, 21, 22]),
  available: true,
  attempted: 3,
  failed: 0,
  availability: 1,
  rank: 0.9,
  routeConsistency: 0.98,
  healthStatus: "healthy" as const,
  loadPct: 20,
  capacityMbps: 10_000,
  availableCapacityMbps: 8_000,
  serverVersion: "1.0.0",
  protocolVersion: 1,
  healthReason: "healthy",
};

describe("secondary verification evidence", () => {
  it("keeps probe-only evidence distinct from throughput consensus", () => {
    const server = { backups: [backup] } as ServerSelection;
    const result = latencyOnlySecondary(server, 500);
    expect(result.status).toBe("latency-only");
    expect(result.secondaryMbps).toBeNull();
    expect(result.method).toBe("latency-only");
  });

  it("marks missing independent endpoints unavailable", () => {
    const result = unavailableSecondary(500);
    expect(result.status).toBe("unavailable");
    expect(result.bytesTransferred).toBe(0);
  });
});
