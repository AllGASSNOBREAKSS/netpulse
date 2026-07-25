import { describe, expect, it } from "vitest";
import {
  analyzeLagMarker,
  classifyIncidents,
  createBlackBoxSession,
  customMonitorMode,
  MONITOR_MODES,
  summarizeBlackBoxSession,
  type BlackBoxSample,
  type BlackBoxSession,
  type DnsObservation,
  type LagMarker,
} from "../blackbox";
import {
  buildBlackBoxExport,
  buildSupportReportData,
  createBlackBoxCsv,
  createPrivacySafeShareUrl,
  createSupportReportText,
  parsePrivacySafeShare,
} from "../blackboxExport";

const QUICK = MONITOR_MODES[0];

describe("Connection Black Box statistics and incidents", () => {
  it("summarizes a stable session without fabricating incidents", () => {
    const session = fixtureSession([24, 26, 25, 27, 24, 25]);
    session.status = "completed";
    session.endedAt = session.startedAt + 12_000;
    const summary = summarizeBlackBoxSession(session);
    expect(summary.latency.median).toBe(25);
    expect(summary.latency.p95).toBeGreaterThanOrEqual(26);
    expect(summary.latency.jitter).toBeGreaterThan(0);
    expect(summary.reachabilityFailures).toBe(0);
    expect(summary.incidents).toEqual([]);
    expect(summary.stablePercent).toBe(100);
    expect(summary.confidence).toBeGreaterThan(80);
  });

  it("groups high latency into a bounded spike incident", () => {
    const session = fixtureSession([25, 24, 26, 310, 290, 27]);
    const incidents = classifyIncidents(session).filter((item) => item.type === "latency-spike");
    expect(incidents).toHaveLength(1);
    expect(incidents[0].evidence[0]).toContain("310 ms");
    expect(incidents[0].affectedEndpoint).toContain("Cloudflare");
    expect(incidents[0].durationMs).toBeGreaterThanOrEqual(QUICK.probeIntervalMs);
  });

  it("detects abrupt jitter from consecutive real latency values", () => {
    const session = fixtureSession([20, 21, 160, 22, 170, 23]);
    expect(classifyIncidents(session).some((item) => item.type === "severe-jitter")).toBe(true);
  });

  it("counts reachability interruptions without calling them packet loss", () => {
    const session = fixtureSession([25, null, null, 26, null, 25]);
    const summary = summarizeBlackBoxSession(session);
    expect(summary.reachabilityFailures).toBe(3);
    expect(summary.interruptionCount).toBe(2);
    const evidence = summary.incidents.filter((item) => item.type === "reachability-interruption").flatMap((item) => item.evidence).join(" ");
    expect(evidence).toContain("not a packet-loss percentage");
  });

  it("classifies a controlled DNS failure with the resolver limitation", () => {
    const session = fixtureSession([25, 26, 24]);
    session.dns.push(dnsFailure(session.startedAt + 2_500));
    const incident = classifyIncidents(session).find((item) => item.type === "dns-failure");
    expect(incident?.evidence.join(" ")).toContain("not the operating system's configured resolver");
    expect(summarizeBlackBoxSession(session).dnsFailures).toBe(1);
  });

  it("uses an independent endpoint response to isolate one-endpoint failure", () => {
    const session = fixtureSession([null]);
    session.secondaryEndpointConfigured = true;
    session.samples[0].secondary = endpoint("ok", 33);
    const incident = classifyIncidents(session).find((item) => item.type === "endpoint-specific-failure");
    expect(incident?.confidence).toBe(80);
  });

  it("separates browser scheduling suspension from network reachability", () => {
    const session = fixtureSession([25, 26, 25]);
    session.samples[1].schedulingDelayMs = 9_000;
    const incident = classifyIncidents(session).find((item) => item.type === "browser-suspension");
    expect(incident?.evidence.join(" ")).toContain("browser started");
    expect(summarizeBlackBoxSession(session).reachabilityFailures).toBe(0);
  });

  it("correlates an I Felt Lag marker without inventing a cause", () => {
    const session = fixtureSession([25, 26, 24, 25, 26]);
    const marker: LagMarker = { id: "lag-clean", at: session.startedAt + 4_000, note: null };
    expect(analyzeLagMarker(session, marker).statement).toBe("No measurable network anomaly was detected around this event.");

    session.samples[2].primary = endpoint("ok", 350);
    const anomaly = analyzeLagMarker(session, marker);
    expect(anomaly.statement).not.toContain("No measurable network anomaly");
    expect(anomaly.incidents.some((item) => item.type === "latency-spike")).toBe(true);
    expect(anomaly.statement).toContain("foreground");
  });

  it("clamps custom monitoring duration to safe limits", () => {
    expect(customMonitorMode(1).durationMs).toBe(5 * 60_000);
    expect(customMonitorMode(999).durationMs).toBe(480 * 60_000);
    expect(customMonitorMode(45).probeIntervalMs).toBe(5_000);
  });

  it("creates a privacy-safe support report and functional share summary", () => {
    const session = fixtureSession([25, 26, 24]);
    session.identity = { isp: "Example ISP", asn: "AS64500", approximateRegion: "Example Region", source: "ipwho.is" };
    const report = buildSupportReportData(session);
    expect(report.networkIdentity.fullPublicIpIncluded).toBe(false);
    expect(report.endpoints.packetLoss).toBe("unavailable");
    const url = createPrivacySafeShareUrl(session, "https://netpulse.example/");
    const shared = parsePrivacySafeShare(new URL(url).hash);
    expect(shared?.privacy).toContain("No public IP");
    expect(shared?.expiresAt).toBeTruthy();
    expect(JSON.stringify(shared)).not.toContain("203.0.113.42");
    expect(parsePrivacySafeShare(new URL(url).hash, Date.now() + 8 * 86_400_000)).toBeNull();
  });

  it("exports complete raw evidence without inventing unavailable values", () => {
    const session = fixtureSession([25, null, 31]);
    const full = buildBlackBoxExport(session);
    const csv = createBlackBoxCsv(session);
    const supportText = createSupportReportText(session);

    expect(full.raw.samples).toHaveLength(3);
    expect(full.methodology.some((line) => line.includes("consecutive"))).toBe(true);
    expect(csv.split("\r\n")).toHaveLength(4);
    expect(csv).toContain("secondary_status");
    expect(csv).toContain("unavailable");
    expect(supportText).toContain("reachability failures 1");
    expect(supportText).toContain("Packet loss is unavailable");
  });

  it("analyzes the maximum retained session within a practical budget", () => {
    const values = Array.from({ length: 5_000 }, (_, index) => 25 + (index % 120 === 0 ? 180 : index % 5));
    const session = fixtureSession(values);
    const started = performance.now();
    const summary = summarizeBlackBoxSession(session);
    expect(performance.now() - started).toBeLessThan(500);
    expect(summary.sampleCount).toBe(5_000);
  });
});

function fixtureSession(values: Array<number | null>): BlackBoxSession {
  const startedAt = 1_700_000_000_000;
  const session = createBlackBoxSession(QUICK, false, startedAt);
  session.samples = values.map((value, index) => sample(startedAt + index * QUICK.probeIntervalMs, value, index));
  session.dataReceivedBytes = session.samples.length * 16;
  return session;
}

function sample(at: number, latency: number | null, index: number): BlackBoxSample {
  return {
    id: `sample-${index}`,
    scheduledAt: at,
    startedAt: at,
    completedAt: at + (latency ?? 5_000),
    schedulingDelayMs: 0,
    visibility: "visible",
    primary: endpoint(latency === null ? "failed" : "ok", latency),
    secondary: endpoint("unavailable", null),
  };
}

function endpoint(status: "ok" | "failed" | "unavailable", durationMs: number | null) {
  return {
    status,
    durationMs,
    bytesReceived: status === "ok" ? 16 : 0,
    detail: status === "ok" ? "completed" : status === "failed" ? "failed" : "unavailable",
  } as const;
}

function dnsFailure(at: number): DnsObservation {
  return {
    id: "dns-failure",
    measuredAt: at,
    status: "failed",
    durationMs: null,
    responseCode: null,
    bytesReceived: 0,
    provider: "Cloudflare DNS over HTTPS",
    detail: "Controlled DNS transaction failed.",
  };
}
