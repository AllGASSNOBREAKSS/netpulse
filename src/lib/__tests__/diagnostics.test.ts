import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONDITIONS,
  DIAGNOSTIC_SCHEMA_VERSION,
  evaluateDiagnostic,
  type DiagnosticConditions,
  type DiagnosticMeasurement,
  type DiagnosticRun,
  type DiagnosticRunKind,
  type DiagnosticSession,
} from "../diagnostics";
import { createPrivacySafeDiagnosticReport } from "../diagnosticReport";

const BASE_MEASUREMENT: DiagnosticMeasurement = {
  downloadMbps: 40,
  uploadMbps: 10,
  idleLatencyMs: 25,
  jitterMs: 4,
  loadedDownMs: 35,
  loadedUpMs: 40,
  bufferbloatDownMs: 10,
  bufferbloatUpMs: 15,
  stabilityScore: 85,
  confidenceScore: 82,
  durationMs: 20_000,
  dataUsedMB: 80,
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
};

describe("deterministic diagnostic engine", () => {
  it("returns no cause before a real baseline exists", () => {
    const evaluation = evaluateDiagnostic(makeSession([]));
    expect(evaluation.assessments).toEqual([]);
    expect(evaluation.summary).toContain("Run a baseline");
  });

  it("supports measured bufferbloat without assigning the queue owner", () => {
    const baseline = makeRun("baseline", {}, { bufferbloatDownMs: 55, bufferbloatUpMs: 130, loadedDownMs: 80, loadedUpMs: 155 });
    const finding = getFinding(evaluateDiagnostic(makeSession([baseline])), "bufferbloat");
    expect(finding.state).toBe("supported");
    expect(finding.evidence[0]).toContain("upload load added 130 ms");
    expect(finding.alternatives.join(" ")).toContain("does not locate its owner");
  });

  it("requires adequate samples and confidence before supporting bufferbloat", () => {
    const baseline = makeRun("baseline", {}, { bufferbloatDownMs: 100, loadedDownSamples: 1, confidenceScore: 40 });
    expect(getFinding(evaluateDiagnostic(makeSession([baseline])), "bufferbloat").state).toBe("possible");
  });

  it("supports measured latency instability from real jitter", () => {
    const baseline = makeRun("baseline", {}, { jitterMs: 21, stabilityScore: 48 });
    expect(getFinding(evaluateDiagnostic(makeSession([baseline])), "latency-instability").state).toBe("supported");
  });

  it("supports a local wireless path only from a confirmed Wi-Fi comparison", () => {
    const baseline = makeRun("baseline", { link: "wifi", location: "usual" }, { downloadMbps: 30, jitterMs: 16, stabilityScore: 55 });
    const near = makeRun("near-router", { link: "wifi", location: "near-router" }, { downloadMbps: 80, jitterMs: 4, stabilityScore: 88 });
    const finding = getFinding(evaluateDiagnostic(makeSession([baseline, near])), "wireless-path");
    expect(finding.state).toBe("supported");
    expect(finding.evidence.join(" ")).toContain("Near Router");
  });

  it("does not assign Wi-Fi when the baseline link was unknown", () => {
    const baseline = makeRun("baseline", { link: "unknown" }, { downloadMbps: 20 });
    const ethernet = makeRun("ethernet", { link: "ethernet" }, { downloadMbps: 100 });
    expect(getFinding(evaluateDiagnostic(makeSession([baseline, ethernet])), "wireless-path").state).toBe("possible");
  });

  it("supports VPN overhead only from a confirmed on/off pair", () => {
    const baseline = makeRun("baseline", { vpn: "on" }, { downloadMbps: 25, idleLatencyMs: 70 });
    const off = makeRun("vpn-off", { vpn: "off" }, { downloadMbps: 90, idleLatencyMs: 25 });
    expect(getFinding(evaluateDiagnostic(makeSession([baseline, off])), "vpn-overhead").state).toBe("supported");

    const unknownBaseline = makeRun("baseline", { vpn: "unknown" }, { downloadMbps: 25 });
    expect(getFinding(evaluateDiagnostic(makeSession([unknownBaseline, off])), "vpn-overhead").state).toBe("possible");
  });

  it("supports competing traffic from a normal-versus-paused pair", () => {
    const baseline = makeRun("baseline", { backgroundTraffic: "normal" }, { uploadMbps: 4, bufferbloatUpMs: 120 });
    const paused = makeRun("background-paused", { backgroundTraffic: "paused" }, { uploadMbps: 15, bufferbloatUpMs: 15 });
    expect(getFinding(evaluateDiagnostic(makeSession([baseline, paused])), "background-traffic").state).toBe("supported");
  });

  it("supports a device/browser candidate only from a co-labeled second device", () => {
    const baseline = makeRun("baseline", { device: "primary" }, { downloadMbps: 20 });
    const other = makeRun("other-device", { device: "other" }, { downloadMbps: 100 });
    expect(getFinding(evaluateDiagnostic(makeSession([baseline, other])), "device-browser").state).toBe("supported");
  });

  it("caps restart evidence because it changes several conditions", () => {
    const baseline = makeRun("baseline", {}, { downloadMbps: 20, confidenceScore: 95 });
    const restarted = makeRun("router-restarted", { afterRestart: "router" }, { downloadMbps: 100, confidenceScore: 95 });
    const finding = getFinding(evaluateDiagnostic(makeSession([baseline, restarted])), "gateway-state");
    expect(finding.state).toBe("supported");
    expect(finding.confidence).toBeLessThanOrEqual(60);
    expect(finding.unlikelyToHelp).toContain("does not prove hardware failure");
  });

  it("supports time-of-day congestion only from a matched peak/off-peak pair", () => {
    const peak = makeRun("peak-time", { time: "peak", link: "ethernet" }, { downloadMbps: 35 });
    const offPeak = makeRun("off-peak", { time: "off-peak", link: "ethernet" }, { downloadMbps: 120 });
    const finding = getFinding(evaluateDiagnostic(makeSession([peak, offPeak])), "peak-congestion");
    expect(finding.state).toBe("supported");
    expect(finding.confidence).toBeLessThanOrEqual(68);
  });

  it("makes ISP/access limitation only possible after diverse confident Ethernet evidence relative to an entered plan", () => {
    const first = makeRun("ethernet", { link: "ethernet", device: "primary", time: "peak" }, { downloadMbps: 100 });
    const second = makeRun("other-device", { link: "ethernet", device: "other", time: "off-peak" }, { downloadMbps: 110 });
    const session = makeSession([first, second], { planDownloadMbps: 500 });
    const finding = getFinding(evaluateDiagnostic(session), "isp-access");
    expect(finding.state).toBe("possible");
    expect(finding.confidence).toBeLessThanOrEqual(65);
  });

  it("keeps DNS, independent routing, packet loss, and regional outage unavailable", () => {
    const evaluation = evaluateDiagnostic(makeSession([makeRun("baseline")]));
    for (const id of ["dns", "route-server", "packet-loss", "regional-outage"] as const) {
      const finding = getFinding(evaluation, id);
      expect(finding.state).toBe("unavailable");
      expect(finding.confidence).toBe(0);
    }
  });

  it("excludes low-evidence possible causes from the prioritized fix plan", () => {
    const evaluation = evaluateDiagnostic(makeSession([makeRun("baseline")]));
    expect(evaluation.prioritized.some((item) => item.id === "vpn-overhead")).toBe(false);
    expect(evaluation.fixPlan).toHaveLength(1);
  });

  it("creates a privacy-safe report with evidence and without identity fields", () => {
    const report = createPrivacySafeDiagnosticReport(makeSession([makeRun("baseline")]));
    expect(report).toContain("Packet loss: unavailable");
    expect(report).toContain("PRIORITIZED FIX PLAN");
    expect(report).not.toContain("203.0.113.42");
    expect(report).not.toContain("MyHomeNetwork");
  });
});

function makeSession(
  runs: DiagnosticRun[],
  changes: Partial<DiagnosticSession> = {},
): DiagnosticSession {
  return {
    schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
    id: "diagnostic-fixture",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    symptom: "other",
    planDownloadMbps: null,
    planUploadMbps: null,
    runs,
    ...changes,
  };
}

function makeRun(
  kind: DiagnosticRunKind,
  conditionChanges: Partial<DiagnosticConditions> = {},
  measurementChanges: Partial<DiagnosticMeasurement> = {},
): DiagnosticRun {
  return {
    id: `run-${kind}`,
    kind,
    label: kind.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
    measuredAt: 1_700_000_000_000,
    conditions: { ...DEFAULT_CONDITIONS, ...conditionChanges },
    measurement: { ...BASE_MEASUREMENT, ...measurementChanges },
  };
}

function getFinding(evaluation: ReturnType<typeof evaluateDiagnostic>, id: CauseAssessmentId) {
  const finding = evaluation.assessments.find((item) => item.id === id);
  if (!finding) throw new Error(`Missing ${id} assessment`);
  return finding;
}

type CauseAssessmentId = ReturnType<typeof evaluateDiagnostic>["assessments"][number]["id"];
