import { describe, expect, it } from "vitest";
import { buildAreaPulseSnapshot, type HistoricalBucket, type StoredAreaReport } from "../../../server/areaPulseAggregation";
import { calculateAreaIncidentConfidence, type CoarseRegion, type OfficialProviderMessage } from "../areaPulse";

const NOW = Date.UTC(2026, 6, 19, 12);
const REGION: CoarseRegion = { key: "us|ny|new york", label: "New York, NY", level: "city", countryCode: "US", approximate: true };

describe("Area Pulse confidence and aggregation", () => {
  it("never publishes a single crowd report as an incident", () => {
    const snapshot = buildAreaPulseSnapshot({ region: REGION, reports: [report(1)], history: [], officialMessages: [], now: NOW });
    expect(snapshot.incidents).toEqual([]);
    expect(snapshot.outcome).toBe("insufficient-evidence");
  });

  it("classifies three matching reporters as possible, not confirmed", () => {
    const snapshot = buildAreaPulseSnapshot({ region: REGION, reports: reports(3), history: [], officialMessages: [], now: NOW });
    expect(snapshot.incidents).toHaveLength(1);
    expect(snapshot.incidents[0]).toMatchObject({ distinctReporters: 3, confidence: "possible" });
    expect(snapshot.incidents[0].sources).toEqual([expect.objectContaining({ kind: "crowd", official: false })]);
  });

  it("does not treat same-provider browser destinations as independent corroboration", () => {
    const matching = reports(5).map((item, index) => ({ ...item, measurement: index % 2 ? { dnsFailed: true, primaryReachable: null } : { dnsFailed: null, primaryReachable: false } }));
    const snapshot = buildAreaPulseSnapshot({ region: REGION, reports: matching, history: [], officialMessages: [], now: NOW });
    expect(snapshot.incidents[0].confidence).toBe("possible");
    expect(snapshot.incidents[0].confidenceReasons.join(" ")).not.toMatch(/independently operated/i);
  });

  it("raises five reporters to likely only with a mature deviating baseline", () => {
    const history: HistoricalBucket[] = Array.from({ length: 8 }, () => ({ providerKey: "as64500", kind: "complete_outage", service: null, count: 1 }));
    const snapshot = buildAreaPulseSnapshot({ region: REGION, reports: reports(5), history, officialMessages: [], now: NOW });
    expect(snapshot.incidents[0].confidence).toBe("likely");
    expect(snapshot.incidents[0].confidenceReasons.join(" ")).toMatch(/historical baseline/i);
  });

  it("keeps conflicting failure patterns in separate clusters and lowers pattern agreement", () => {
    const mixed = [...reports(3), ...reports(3, "dns_problem", 10)];
    const snapshot = buildAreaPulseSnapshot({ region: REGION, reports: mixed, history: [], officialMessages: [], now: NOW });
    expect(snapshot.incidents).toHaveLength(2);
    expect(snapshot.incidents.every((incident) => incident.confidence === "possible")).toBe(true);
    expect(snapshot.incidents.every((incident) => incident.confidenceReasons.join(" ").includes("100%"))).toBe(false);
  });

  it("uses an active signed-source record for the official classification", () => {
    const official: OfficialProviderMessage = {
      id: "provider-notice-1", isp: "Example ISP", asn: "AS64500", region: REGION,
      title: "Regional maintenance", message: "The provider reports an active incident.", status: "active",
      publishedAt: new Date(NOW - 60_000).toISOString(), expiresAt: new Date(NOW + 3_600_000).toISOString(),
      sourceUrl: "https://status.example.com/incidents/1", sourceLabel: "Example ISP status", official: true,
    };
    const snapshot = buildAreaPulseSnapshot({ region: REGION, reports: [report(1)], history: [], officialMessages: [official], now: NOW });
    expect(snapshot.incidents[0]).toMatchObject({ confidence: "official", confidenceScore: 100 });
    expect(snapshot.incidents[0].sources).toContainEqual(expect.objectContaining({ kind: "official-provider", official: true }));
  });

  it("documents the independent-evidence threshold in the pure confidence formula", () => {
    const result = calculateAreaIncidentConfidence({ distinctReporters: 5, matchingPatternRatio: 1, baselineWindows: 0, baselineMean: 0, baselineStddev: 0, multiDestinationCorroborated: true, officialProviderConfirmed: false });
    expect(result.level).toBe("likely");
    expect(result.reasons.join(" ")).toMatch(/independently operated destinations/i);
  });
});

function reports(count: number, kind: StoredAreaReport["kind"] = "complete_outage", offset = 0): StoredAreaReport[] {
  return Array.from({ length: count }, (_, index) => report(index + offset, kind));
}

function report(index: number, kind: StoredAreaReport["kind"] = "complete_outage"): StoredAreaReport {
  return {
    id: `report-${index}`, createdAt: new Date(NOW - index * 1_000), expiresAt: new Date(NOW + 3_600_000), kind,
    providerKey: "as64500", isp: "Example ISP", asn: "AS64500", region: REGION, service: null,
    reporterKey: `reporter-${index}`, measurement: null,
  };
}
