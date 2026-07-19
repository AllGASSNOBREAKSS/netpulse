import { describe, expect, it } from "vitest";
import { rankProbes } from "../servers";
import { summarize } from "../stats";
import type { ServerProbe } from "../types";

function probe(id: string, rtts: number[], available = true, ipFamily: ServerProbe["ipFamily"] = "IPv4"): ServerProbe {
  return {
    id,
    provider: id,
    city: null,
    region: null,
    approxDistanceKm: null,
    asn: null,
    protocol: "HTTPS",
    ipFamily,
    latency: summarize(rtts),
    available,
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
});
