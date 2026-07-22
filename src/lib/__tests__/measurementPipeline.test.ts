import { afterEach, describe, expect, it, vi } from "vitest";
import { MeasurementRunRecorder } from "../measurementPipeline";

afterEach(() => {
  vi.useRealTimers();
});

describe("MeasurementRunRecorder", () => {
  it("retains every event immediately and batches non-terminal progress", () => {
    vi.useFakeTimers();
    const batches: string[][] = [];
    const recorder = new MeasurementRunRecorder({
      runId: "np-test",
      startedAt: 1_000,
      monotonicStart: performance.now(),
      flushIntervalMs: 100,
      onBatch: (events) => batches.push(events.map((event) => event.kind)),
    });

    recorder.emit("download-progress", "measuring-download", { mbps: 10 });
    recorder.emit("download-progress", "measuring-download", { mbps: 20 });

    expect(recorder.events).toHaveLength(2);
    expect(batches).toHaveLength(0);
    vi.advanceTimersByTime(100);
    expect(batches).toEqual([["download-progress", "download-progress"]]);
    expect(recorder.events.map((event) => event.sequence)).toEqual([0, 1]);
  });

  it("records phase attempts and terminal metadata", () => {
    const recorder = new MeasurementRunRecorder({
      runId: "np-test",
      startedAt: 1_000,
      monotonicStart: performance.now(),
    });
    const token = recorder.begin("preflight");
    recorder.complete(token, { browser: "test" });

    expect(recorder.phases).toHaveLength(1);
    expect(recorder.phases[0]).toMatchObject({ phase: "preflight", attempt: 1, status: "completed" });
    expect(recorder.events.map((event) => event.kind)).toEqual(["phase-started", "phase-completed"]);
  });
});
