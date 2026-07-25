import { describe, expect, it } from "vitest";
import { createBlackBoxSession, MONITOR_MODES } from "../blackbox";
import {
  deleteBlackBoxSession,
  loadBlackBoxSessions,
  saveBlackBoxSession,
  saveRetentionDays,
} from "../blackboxSessions";

describe("Connection Black Box local storage", () => {
  it("round-trips sessions and recovers a refreshed running session as interrupted", () => {
    const storage = new MemoryStorage();
    const session = createBlackBoxSession(MONITOR_MODES[0], false, 1_700_000_000_000);
    session.samples.push({
      id: "sample",
      scheduledAt: session.startedAt,
      startedAt: session.startedAt,
      completedAt: session.startedAt + 25,
      schedulingDelayMs: 0,
      visibility: "visible",
      primary: { status: "ok", durationMs: 25, bytesReceived: 0, detail: "completed" },
      secondary: { status: "unavailable", durationMs: null, bytesReceived: 0, detail: "unavailable" },
    });
    expect(saveBlackBoxSession(session, storage).ok).toBe(true);
    const loaded = loadBlackBoxSessions(storage, session.startedAt + 5_000);
    expect(loaded.value[0].status).toBe("interrupted");
    expect(loaded.value[0].samples).toHaveLength(1);
  });

  it("rejects corrupt and future-schema sessions", () => {
    const storage = new MemoryStorage();
    storage.setItem("netpulse_blackbox_sessions_v1", JSON.stringify([{ id: "bad" }, { ...createBlackBoxSession(MONITOR_MODES[0], false, 1_700_000_000_000), schemaVersion: 99 }]));
    expect(loadBlackBoxSessions(storage, 1_700_000_001_000).value).toEqual([]);
  });

  it("applies retention, deletion, and the ten-session cap", () => {
    const storage = new MemoryStorage();
    const now = 1_700_000_000_000;
    expect(saveRetentionDays(7, storage).ok).toBe(true);
    for (let index = 0; index < 12; index += 1) {
      const session = createBlackBoxSession(MONITOR_MODES[0], false, now - index * 60_000);
      session.status = "stopped";
      session.endedAt = session.startedAt + 10_000;
      saveBlackBoxSession(session, storage, now, 7);
    }
    const loaded = loadBlackBoxSessions(storage, now, 7);
    expect(loaded.value).toHaveLength(10);
    const removed = deleteBlackBoxSession(loaded.value[0].id, storage, now, 7);
    expect(removed.value).toHaveLength(9);
  });

  it("returns an actionable error when storage writes fail", () => {
    const storage = new MemoryStorage(true);
    const session = createBlackBoxSession(MONITOR_MODES[0], false, 1_700_000_000_000);
    const result = saveBlackBoxSession(session, storage);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Could not save");
  });
});

class MemoryStorage {
  private values = new Map<string, string>();
  constructor(private readonly failWrites = false) {}

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error("quota exceeded");
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    if (this.failWrites) throw new Error("storage blocked");
    this.values.delete(key);
  }
}
