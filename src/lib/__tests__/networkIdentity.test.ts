import { afterEach, describe, expect, it, vi } from "vitest";
import { lookupNetworkIdentity } from "../networkIdentity";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("opt-in network identity lookup", () => {
  it("validates fields and returns only a masked IP", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          success: true,
          ip: "203.0.113.42",
          type: "IPv4",
          city: "Example City",
          region: "Example Region",
          country: "Exampleland",
          country_code: "EX",
          connection: { asn: 64500, isp: "Example ISP", org: "Example Network" },
        }),
      ),
    );

    const result = await lookupNetworkIdentity();

    expect(result.asn).toBe("AS64500");
    expect(result.isp).toBe("Example ISP");
    expect(result.ipMasked).toBe("203.0.•••.•••");
    expect(JSON.stringify(result)).not.toContain("203.0.113.42");
  });

  it("rejects an unsuccessful or malformed response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: false, message: "limited" })));

    await expect(lookupNetworkIdentity()).rejects.toThrow("usable network metadata");
  });
});
