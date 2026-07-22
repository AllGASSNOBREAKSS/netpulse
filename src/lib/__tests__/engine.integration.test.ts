import { afterEach, describe, expect, it, vi } from "vitest";
import { runTest } from "../engine";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("measurement pipeline integration", () => {
  it("assembles a complete low-data result from timed provider responses", async () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/136.0",
      connection: { effectiveType: "4g" },
    });
    vi.stubGlobal("window", {
      isSecureContext: true,
      matchMedia: () => ({ matches: false }),
      RTCPeerConnection: undefined,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("cdn-cgi/trace")) {
          return new Response("ip=203.0.113.42\nloc=US\ncolo=IAD\nwarp=off\n", { status: 200 });
        }
        if (init?.method === "POST" || url.includes("/__up")) {
          return new Response(new Uint8Array(), { status: 200 });
        }
        if (url.includes("bytes=0")) {
          return new Response(new Uint8Array(), { status: 200 });
        }
        return new Response(new Uint8Array(1_000_000), { status: 200 });
      }),
    );

    const phases: string[] = [];
    const result = await runTest({ lowData: true }, { onPhase: (phase) => phases.push(phase) });

    expect(phases).toEqual([
      "preflight",
      "server",
      "latency",
      "download_single",
      "download_multi",
      "upload",
      "packetloss",
      "done",
    ]);
    expect(result.downloadMbps).toBeGreaterThan(0);
    expect(result.uploadMbps).toBeGreaterThan(0);
    expect(result.idleLatency.count).toBe(10);
    expect(result.loadedDown.count).toBeGreaterThan(0);
    expect(result.loadedUp.count).toBeGreaterThan(0);
    expect(result.dataUsedMB).toBeGreaterThan(0);
    expect(result.ispLocation.ipMasked).toBe("203.0.•••.•••");
    expect(result.packetLoss.status).toBe("unavailable");
    expect(result.confidence.reasons.some((reason) => reason.label === "Upload duration")).toBe(true);
    expect(result.samples.every((sample) => sample.t >= 0)).toBe(true);
    expect(result.schemaVersion).toBe(4);
    expect(result.runId).toMatch(/^np-/);
    expect(result.rawEvidence.events.length).toBeGreaterThan(result.samples.length);
    expect(result.rawEvidence.phases.every((phase) => phase.status === "completed")).toBe(true);
    expect(result.accuracyPassport.validSampleCount).toBe(result.samples.length);
    expect(result.accuracyPassport.secondaryVerification.status).toBe("unavailable");
    expect(result.preflight.ipComparison.ipv4.successful).toBeGreaterThan(0);
    expect(result.transportTelemetry.serverTransport).toBe("unknown");
    expect(result.download.multi.p5Mbps).toBeLessThanOrEqual(result.download.multi.p95Mbps);
    expect(result.download.multi.streams).toBeGreaterThan(0);
  });

  it("cancels before network work when the caller signal is already aborted", async () => {
    vi.stubGlobal("navigator", { userAgent: "test", hardwareConcurrency: 4 });
    vi.stubGlobal("window", { isSecureContext: true, matchMedia: () => ({ matches: false }) });
    const controller = new AbortController();
    controller.abort();

    await expect(runTest({ lowData: true, signal: controller.signal }, {})).rejects.toMatchObject({
      name: "MeasurementCancelledError",
    });
  });
});
