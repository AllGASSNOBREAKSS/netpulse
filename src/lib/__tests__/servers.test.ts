import { describe, expect, it } from "vitest";
import { rankProbes } from "../servers";
import { summarize } from "../stats";
import type { ServerProbe } from "../types";

function probe(
  id: string,
  rtts: number[],
  available = true,
  ipFamily: ServerProbe["ipFamily"] = "IPv4",
  attempted = rtts.length,
): ServerProbe {
  const failed = Math.max(0, attempted - rtts.length);
  return {
    id,
    provider: id,
    edgeCode: null,
    clientCountryCode: null,
    city: null,
    region: null,
    approximateDistanceKm: null,
    protocol: "HTTPS",
    ipFamily,
    latency: summarize(rtts),
    available,
    attempted,
    failed,
    availability: attempted > 0 ? rtts.length / attempted : 0,
    rank: 0,
  };
}

describe("server ranking", () => {
  it("ranks the lowest-latency, steadiest server first", () => {
    const ranked = rankProbes([
      probe("far", [120, 130, 125]),
      probe("near", [18, 20, 19]),
      probe("jittery", [40, 90, 30, 110]),
    ]);
    expect(ranked[0].id).toBe("near");
  });

  it("pushes unavailable servers to rank 0 and last", () => {
    const ranked = rankProbes([
      probe("down", [], false),
      probe("up", [25, 26, 24]),
    ]);
    expect(ranked[0].id).toBe("up");
    expect(ranked.find((p) => p.id === "down")!.rank).toBe(0);
  });

  it("carries IPv4/IPv6 family through ranking", () => {
    const ranked = rankProbes([
      probe("v6", [22, 23, 21], true, "IPv6"),
      probe("v4", [30, 31, 29], true, "IPv4"),
    ]);
    expect(ranked[0].ipFamily).toBe("IPv6");
  });

  it("penalizes a server that succeeds only intermittently", () => {
    const ranked = rankProbes([
      probe("lucky", [10], true, "IPv4", 6),
      probe("reliable", [20, 21, 19, 20, 22, 18], true, "IPv4", 6),
    ]);
    expect(ranked[0].id).toBe("reliable");
    expect(ranked[0].rank).toBeGreaterThan(ranked[1].rank);
  });
});
