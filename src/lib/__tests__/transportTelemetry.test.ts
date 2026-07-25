import { afterEach, describe, expect, it, vi } from "vitest";
import { collectTransportTelemetry } from "../transportTelemetry";

afterEach(() => vi.unstubAllGlobals());

describe("transport telemetry", () => {
  it("accepts only explicit bounded server telemetry", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(), {
      status: 200,
      headers: {
        "x-netpulse-transport": "quic",
        "x-netpulse-quic-rtt-ms": "18.5",
        "x-netpulse-retransmits": "2",
        "server-timing": "edge;dur=2",
      },
    })));
    const result = await collectTransportTelemetry("cloudflare");
    expect(result.serverTransport).toBe("quic");
    expect(result.serverReportedQuicRttMs).toBe(18.5);
    expect(result.serverReportedRetransmits).toBe(2);
    expect(result.serverReportedTcpRttMs).toBeNull();
  });

  it("leaves unsupported values unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(), {
      status: 200,
      headers: { "x-netpulse-tcp-rtt-ms": "not-a-number", "x-netpulse-retransmits": "-1" },
    })));
    const result = await collectTransportTelemetry("cloudflare");
    expect(result.serverTransport).toBe("unknown");
    expect(result.serverReportedTcpRttMs).toBeNull();
    expect(result.serverReportedRetransmits).toBeNull();
  });

  it("does not describe a generic Server-Timing header as TCP or QUIC telemetry", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(), {
      status: 200,
      headers: { "server-timing": "edge;dur=2" },
    })));
    const result = await collectTransportTelemetry("cloudflare");
    expect(result.serverTransport).toBe("unknown");
    expect(result.serverTiming).toBe("edge;dur=2");
    expect(result.reason).toContain("generic Server-Timing");
    expect(result.reason).toContain("TCP/QUIC RTT and retransmit telemetry were unavailable");
  });
});
