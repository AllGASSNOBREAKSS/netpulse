import { AREA_PULSE_WINDOW_MS, areaReportLabel, calculateAreaIncidentConfidence, type AreaPulseIncident, type AreaPulseOutcome, type AreaPulseSnapshot, type AreaPulseSource, type CoarseRegion, type OfficialProviderMessage } from "../src/lib/areaPulse";

export type StoredAreaReport = {
  id: string;
  createdAt: Date;
  expiresAt: Date;
  kind: Parameters<typeof areaReportLabel>[0];
  providerKey: string;
  isp: string;
  asn: string | null;
  region: CoarseRegion;
  service: string | null;
  reporterKey: string;
  measurement: { dnsFailed: boolean | null; primaryReachable: boolean | null } | null;
};

export type HistoricalBucket = { providerKey: string; kind: StoredAreaReport["kind"]; service: string | null; count: number };

export function buildAreaPulseSnapshot(options: { region: CoarseRegion; reports: StoredAreaReport[]; history: HistoricalBucket[]; officialMessages: OfficialProviderMessage[]; now?: number }): AreaPulseSnapshot {
  const now = options.now ?? Date.now();
  const recent = options.reports.filter((report) => report.createdAt.getTime() >= now - AREA_PULSE_WINDOW_MS && report.expiresAt.getTime() > now);
  const grouped = new Map<string, StoredAreaReport[]>();
  for (const report of recent) {
    const key = `${report.providerKey}|${report.kind}|${report.service?.toLowerCase() ?? ""}`;
    grouped.set(key, [...(grouped.get(key) ?? []), report]);
  }
  const incidents: AreaPulseIncident[] = [];
  const matchedOfficial = new Set<string>();

  for (const reports of grouped.values()) {
    const first = reports[0];
    const reporterCount = new Set(reports.map((report) => report.reporterKey)).size;
    const providerWindowReports = recent.filter((report) => report.providerKey === first.providerKey);
    const samePatternRatio = providerWindowReports.length ? reports.length / providerWindowReports.length : 0;
    const official = options.officialMessages.find((message) => providerMatches(first.providerKey, message) && (!message.region || message.region.key === options.region.key) && new Date(message.expiresAt).getTime() > now);
    if (official) matchedOfficial.add(official.id);
    const baseline = options.history.filter((bucket) => bucket.providerKey === first.providerKey && bucket.kind === first.kind && (bucket.service ?? "") === (first.service ?? "")).map((bucket) => bucket.count);
    const mean = baseline.length ? baseline.reduce((sum, value) => sum + value, 0) / baseline.length : 0;
    const stddev = baseline.length ? Math.sqrt(baseline.reduce((sum, value) => sum + (value - mean) ** 2, 0) / baseline.length) : 0;
    // The current browser checks use separate Cloudflare request categories. They
    // are useful diagnostics, but are not independently operated infrastructure
    // and therefore must not raise a crowd report to "likely" confidence.
    const independentlyCorroborated = false;
    const confidence = calculateAreaIncidentConfidence({ distinctReporters: reporterCount, matchingPatternRatio: samePatternRatio, baselineWindows: baseline.length, baselineMean: mean, baselineStddev: stddev, multiDestinationCorroborated: independentlyCorroborated, officialProviderConfirmed: Boolean(official) });
    if (confidence.level === "insufficient") continue;
    const startedAt = Math.min(...reports.map((report) => report.createdAt.getTime()));
    const lastObservedAt = Math.max(...reports.map((report) => report.createdAt.getTime()));
    const services = first.kind === "service_unavailable" && first.service ? [first.service] : [areaReportLabel(first.kind)];
    const sources: AreaPulseSource[] = [{ kind: "crowd", label: `${reporterCount} distinct anonymous NetPulse reporters`, observedAt: new Date(lastObservedAt).toISOString(), url: null, official: false }];
    if (baseline.length >= 8) sources.push({ kind: "historical-baseline", label: `${baseline.length} comparable historical regional windows`, observedAt: new Date(now).toISOString(), url: null, official: false });
    if (official) sources.push({ kind: "official-provider", label: official.sourceLabel, observedAt: official.publishedAt, url: official.sourceUrl, official: true });
    incidents.push({ id: clusterId(first.providerKey, first.kind, first.service, startedAt), isp: first.isp, asn: first.asn, region: first.region, startedAt: new Date(startedAt).toISOString(), lastObservedAt: new Date(lastObservedAt).toISOString(), expiresAt: new Date(Math.min(lastObservedAt + 60 * 60_000, Math.max(...reports.map((report) => report.expiresAt.getTime())))).toISOString(), affectedServices: services, reportCount: reports.length, distinctReporters: reporterCount, confidence: confidence.level, confidenceScore: confidence.score, confidenceReasons: confidence.reasons, status: "active", sources });
  }

  for (const message of options.officialMessages) {
    if (matchedOfficial.has(message.id) || new Date(message.expiresAt).getTime() <= now || (message.region && message.region.key !== options.region.key)) continue;
    incidents.push({ id: `official-${message.id}`, isp: message.isp, asn: message.asn, region: message.region ?? options.region, startedAt: message.publishedAt, lastObservedAt: message.publishedAt, expiresAt: message.expiresAt, affectedServices: [message.title], reportCount: 0, distinctReporters: 0, confidence: "official", confidenceScore: 100, confidenceReasons: ["An active notice was ingested from a configured official provider source."], status: message.status, sources: [{ kind: "official-provider", label: message.sourceLabel, observedAt: message.publishedAt, url: message.sourceUrl, official: true }] });
  }

  incidents.sort((a, b) => b.confidenceScore - a.confidenceScore || Date.parse(b.lastObservedAt) - Date.parse(a.lastObservedAt));
  return {
    generatedAt: new Date(now).toISOString(),
    region: options.region,
    incidents,
    officialMessages: options.officialMessages.filter((message) => new Date(message.expiresAt).getTime() > now && (!message.region || message.region.key === options.region.key)),
    outcome: outcomeFor(incidents, options.history.length),
    limitations: [
      "IP-based regions are approximate and can be wrong, especially for VPN, mobile, enterprise, and satellite users.",
      "A public incident requires at least three distinct privacy-preserving reporter keys; one report is never declared an outage.",
      "NetPulse has no proprietary ISP outage feed. Only configured official sources can produce an official confirmation badge.",
      "Regional reports do not prove whether a fault is inside a home, on an ISP route, at a destination, or elsewhere without corroborating evidence.",
    ],
  };
}

function outcomeFor(incidents: AreaPulseIncident[], baselineWindows: number): AreaPulseOutcome {
  if (incidents.some((incident) => incident.confidence === "official" || incident.confidence === "likely")) return "possible-regional-disruption";
  if (incidents.some((incident) => incident.affectedServices.some((service) => !["Complete outage", "Intermittent connection", "Slow speed", "High latency", "DNS problem"].includes(service)))) return "destination-specific-problem";
  if (incidents.length > 0) return "possible-regional-disruption";
  return baselineWindows >= 8 ? "no-regional-incident" : "insufficient-evidence";
}

function providerMatches(providerKey: string, message: OfficialProviderMessage): boolean {
  const candidate = message.asn?.toLowerCase() ?? message.isp.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
  return candidate === providerKey;
}

function clusterId(providerKey: string, kind: string, service: string | null, startedAt: number): string {
  return `${providerKey}-${kind}-${service?.toLowerCase().replace(/[^a-z0-9]+/g, "-") ?? "general"}-${Math.floor(startedAt / AREA_PULSE_WINDOW_MS)}`;
}
