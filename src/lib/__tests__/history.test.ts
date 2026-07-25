import { describe, expect, it } from "vitest";
import { parseHistory, serializeHistory, type HistoryEntry } from "../history";

describe("history serialization", () => {
  it("round-trips a publishable result without changing measured values", () => {
    const entry: HistoryEntry = {
      runId: "np-test",
      ts: 1_753_480_000_000,
      down: 742.4,
      up: 38.7,
      ping: 18,
      bloat: 24,
      grade: "A",
      score: 91,
      dataMB: 420,
      confidence: 88,
      durationMs: 31_000,
    };
    expect(parseHistory(serializeHistory([entry]))).toEqual([entry]);
  });

  it("rejects unavailable throughput instead of serializing it as zero", () => {
    const invalid = JSON.stringify([{
      ts: 1,
      down: null,
      up: null,
      ping: 20,
      bloat: 30,
      grade: "B",
      score: 70,
      dataMB: 10,
    }]);
    expect(parseHistory(invalid)).toEqual([]);
  });
});
