import { afterEach, describe, expect, it, vi } from "vitest";
import { collectBlackBoxProbe, measureDnsTransaction, measureEndpointObservation } from "../blackboxProbe";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Connection Black Box real-probe assembly", () => {
  it("records a successful controlled DNS-over-HTTPS transaction", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ Status: 0, Answer: [] }), { status: 200 })));
    const result = await measureDnsTransaction();
    expect(result.status).toBe("ok");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.bytesReceived).toBeGreaterThan(0);
    expect(result.detail).toContain("not the operating system resolver");
  });

  it("records DNS service failure without substituting a duration", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));
    const result = await measureDnsTransaction();
    expect(result.status).toBe("failed");
    expect(result.durationMs).toBeNull();
  });

  it("retains endpoint edge and IP-family reachability without storing the echoed IP", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("2606:4700")) return new Response("ip=2001:db8::1\ncolo=IAD\n", { status: 200 });
      return new Response("ip=203.0.113.42\ncolo=IAD\n", { status: 200 });
    }));
    const result = await measureEndpointObservation();
    expect(result.edgeCode).toBe("IAD");
    expect(result.observedIpFamily).toBe("IPv4");
    expect(result.ipv4.status).toBe("ok");
    expect(result.ipv6.status).toBe("ok");
    expect(JSON.stringify(result)).not.toContain("203.0.113.42");
  });

  it("distinguishes a primary failure from a configured secondary success", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      return url.includes("secondary.example") ? new Response(new Uint8Array([1]), { status: 200 }) : new Response("down", { status: 503 });
    }));
    const collected = await collectBlackBoxProbe({
      scheduledAt: 1_700_000_000_000,
      schedulingDelayMs: 12,
      visibility: "visible",
      includeDns: false,
      includeTrace: false,
      secondaryUrl: "https://secondary.example/health",
    });
    expect(collected.sample.primary.status).toBe("failed");
    expect(collected.sample.secondary.status).toBe("ok");
    expect(collected.bytesReceived).toBe(1);
  });
});
