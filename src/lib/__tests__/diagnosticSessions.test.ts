import { describe, expect, it } from "vitest";
import { DEFAULT_CONDITIONS, DIAGNOSTIC_SCHEMA_VERSION, type DiagnosticSession } from "../diagnostics";
import { deleteDiagnosticSession, loadDiagnosticSessions, saveDiagnosticSession } from "../diagnosticSessions";

describe("local diagnostic session persistence", () => {
  it("round-trips a valid privacy-safe session", () => {
    const storage = new MemoryStorage();
    const session = fixtureSession("first");
    saveDiagnosticSession(session, storage);
    expect(loadDiagnosticSessions(storage)[0]).toMatchObject({ id: "first", symptom: "gaming" });
  });

  it("rejects corrupt or future-schema records", () => {
    const storage = new MemoryStorage();
    storage.setItem("netpulse_diagnostic_sessions_v1", JSON.stringify([{ id: "bad" }, { ...fixtureSession("future"), schemaVersion: 99 }]));
    expect(loadDiagnosticSessions(storage)).toEqual([]);
  });

  it("replaces an existing session and deletes only the requested session", () => {
    const storage = new MemoryStorage();
    saveDiagnosticSession(fixtureSession("one"), storage);
    saveDiagnosticSession(fixtureSession("two"), storage);
    saveDiagnosticSession({ ...fixtureSession("one"), symptom: "video-calls" }, storage);
    const sessions = loadDiagnosticSessions(storage);
    expect(sessions).toHaveLength(2);
    expect(sessions[0].symptom).toBe("video-calls");
    expect(deleteDiagnosticSession("one", storage).map((session) => session.id)).toEqual(["two"]);
  });

  it("caps stored sessions at twelve", () => {
    const storage = new MemoryStorage();
    for (let index = 0; index < 15; index += 1) saveDiagnosticSession(fixtureSession(`session-${index}`), storage);
    expect(loadDiagnosticSessions(storage)).toHaveLength(12);
  });
});

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function fixtureSession(id: string): DiagnosticSession {
  return {
    schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
    id,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    symptom: "gaming",
    planDownloadMbps: null,
    planUploadMbps: null,
    runs: [
      {
        id: `run-${id}`,
        kind: "baseline",
        label: "Baseline",
        measuredAt: 1_700_000_000_000,
        conditions: DEFAULT_CONDITIONS,
        measurement: {
          downloadMbps: 100,
          uploadMbps: 20,
          idleLatencyMs: 20,
          jitterMs: 3,
          loadedDownMs: 30,
          loadedUpMs: 35,
          bufferbloatDownMs: 10,
          bufferbloatUpMs: 15,
          stabilityScore: 90,
          confidenceScore: 85,
          durationMs: 20_000,
          dataUsedMB: 100,
          idleSamples: 12,
          loadedDownSamples: 8,
          loadedUpSamples: 6,
          endpointProvider: "Cloudflare",
          endpointEdge: "IAD",
          endpointProtocol: "HTTPS (fetch)",
          observedIpFamily: "IPv4",
          lowData: false,
          packetLossStatus: "unavailable",
          limitations: ["Packet loss is unavailable."],
        },
      },
    ],
  };
}
