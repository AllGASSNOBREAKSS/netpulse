import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadPhase, uploadPhase, type LoadOpts } from "../throughput";

const base: LoadOpts = {
  streams: 1,
  maxDurationMs: 1_000,
  maxBytes: 1_024,
  minDurationMs: 0,
  chunkBytes: 1_024,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("throughput phases", () => {
  it("keeps a final partial window when a fast download ends before 250 ms", async () => {
    const onBytes = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("bytes=0")) return new Response(new Uint8Array(), { status: 200 });
        return new Response(new Uint8Array(1_024), { status: 200 });
      }),
    );

    const result = await downloadPhase({ ...base, onBytes });

    expect(result.bytes).toBe(1_024);
    expect(result.samples).toHaveLength(1);
    expect(result.mbps).toBeGreaterThan(0);
    expect(result.rtts).toHaveLength(1);
    expect(result.failedRequests).toBe(0);
    expect(onBytes).toHaveBeenLastCalledWith(1_024);
  });

  it("rejects a download when the endpoint returns no usable data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        return url.includes("bytes=0")
          ? new Response(new Uint8Array(), { status: 200 })
          : new Response("unavailable", { status: 503 });
      }),
    );

    await expect(downloadPhase(base)).rejects.toThrow("transferred no usable data");
  });

  it("measures a fast upload from its final partial window", async () => {
    const onBytes = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(), { status: 200 })),
    );

    const result = await uploadPhase({ ...base, onBytes });

    expect(result.bytes).toBe(1_024);
    expect(result.samples).toHaveLength(1);
    expect(result.mbps).toBeGreaterThan(0);
    expect(result.failedRequests).toBe(0);
    expect(result.peakMbps).toBe(result.mbps);
    expect(onBytes).toHaveBeenLastCalledWith(1_024);
  });
});
