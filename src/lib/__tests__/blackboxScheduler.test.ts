import { describe, expect, it, vi } from "vitest";
import { runBlackBoxScheduler } from "../blackboxScheduler";

describe("Connection Black Box scheduler cleanup", () => {
  it("stops cleanly after abort and does not emit later ticks", async () => {
    vi.useFakeTimers();
    let monotonic = 0;
    const controller = new AbortController();
    const ticks: number[] = [];
    const scheduler = runBlackBoxScheduler({
      intervalMs: 1_000,
      signal: controller.signal,
      monotonicNow: () => monotonic,
      wallNow: () => 1_700_000_000_000 + monotonic,
      onTick: async ({ scheduledAt }) => {
        ticks.push(scheduledAt);
        if (ticks.length === 2) controller.abort();
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    monotonic = 1_000;
    await vi.advanceTimersByTimeAsync(1_000);
    await scheduler;
    monotonic = 5_000;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(ticks).toHaveLength(2);
    vi.useRealTimers();
  });
});
