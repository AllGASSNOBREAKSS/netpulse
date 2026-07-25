export const AREA_PULSE_MIN_REPORTS = 3;
export const AREA_PULSE_LIKELY_REPORTS = 5;
export const AREA_PULSE_WINDOW_MS = 30 * 60_000;

export type AreaReportKind =
  | "complete_outage"
  | "intermittent"
  | "slow_speed"
  | "high_latency"
  | "dns_problem"
  | "service_unavailable";

export type IncidentConfidence = "insufficient" | "possible" | "likely" | "official";
export type IncidentStatus = "active" | "monitoring" | "resolved";
export type RegionLevel = "city" | "subdivision" | "country";

export type CoarseRegion = {
  key: string;
  label: string;
  level: RegionLevel;
  countryCode: string;
  approximate: true;
};

export type AreaPulseSource = {
  kind: "crowd" | "official-provider" | "independent-check" | "historical-baseline";
  label: string;
  observedAt: string;
  url: string | null;
  official: boolean;
};

export type AreaPulseIncident = {
  id: string;
  isp: string;
  asn: string | null;
  region: CoarseRegion;
  startedAt: string;
  lastObservedAt: string;
  expiresAt: string;
  affectedServices: string[];
  reportCount: number;
  distinctReporters: number;
  confidence: IncidentConfidence;
  confidenceScore: number;
  confidenceReasons: string[];
  status: IncidentStatus;
  sources: AreaPulseSource[];
};

export type OfficialProviderMessage = {
  id: string;
  isp: string;
  asn: string | null;
  region: CoarseRegion | null;
  title: string;
  message: string;
  status: IncidentStatus;
  publishedAt: string;
  expiresAt: string;
  sourceUrl: string;
  sourceLabel: string;
  official: true;
};

export type AreaPulseContext = {
  available: boolean;
  reportingAvailable: boolean;
  reason: string | null;
  region: CoarseRegion | null;
  turnstileSiteKey: string | null;
  retentionDays: number;
  minimumReports: number;
  locationNotice: string;
};

export type AreaPulseSnapshot = {
  generatedAt: string;
  region: CoarseRegion | null;
  incidents: AreaPulseIncident[];
  officialMessages: OfficialProviderMessage[];
  outcome: AreaPulseOutcome;
  limitations: string[];
};

export type AreaPulseOutcome =
  | "possible-device-problem"
  | "possible-local-network-problem"
  | "isp-connection-degraded"
  | "possible-regional-disruption"
  | "destination-specific-problem"
  | "general-internet-incident"
  | "no-regional-incident"
  | "insufficient-evidence";

export type AreaPulseReportInput = {
  kind: AreaReportKind;
  isp: string;
  asn: string | null;
  service: string | null;
  note: string | null;
  turnstileToken: string;
  identityConsent: boolean;
  measurement: {
    confidence: number | null;
    downloadMbps: number | null;
    uploadMbps: number | null;
    idleLatencyMs: number | null;
    dnsFailed: boolean | null;
    primaryReachable: boolean | null;
  } | null;
};

export type ConfidenceEvidence = {
  distinctReporters: number;
  matchingPatternRatio: number;
  baselineWindows: number;
  baselineMean: number;
  baselineStddev: number;
  multiDestinationCorroborated: boolean;
  officialProviderConfirmed: boolean;
};

export function calculateAreaIncidentConfidence(evidence: ConfidenceEvidence): {
  level: IncidentConfidence;
  score: number;
  reasons: string[];
} {
  if (evidence.officialProviderConfirmed) {
    return { level: "official", score: 100, reasons: ["An active notice from a configured official provider source matches this provider and region."] };
  }

  if (evidence.distinctReporters < AREA_PULSE_MIN_REPORTS) {
    return {
      level: "insufficient",
      score: 0,
      reasons: [`${evidence.distinctReporters} distinct report(s); at least ${AREA_PULSE_MIN_REPORTS} are required before public incident classification.`],
    };
  }

  const reasons = [`${evidence.distinctReporters} distinct privacy-preserving reporter keys match the provider, coarse region, and time window.`];
  let score = 45 + Math.min(20, (evidence.distinctReporters - AREA_PULSE_MIN_REPORTS) * 5);
  if (evidence.matchingPatternRatio >= 0.75) {
    score += 10;
    reasons.push(`${Math.round(evidence.matchingPatternRatio * 100)}% of reports share the same failure pattern.`);
  }
  if (evidence.multiDestinationCorroborated) {
    score += 15;
    reasons.push("Multiple independently operated destinations show a compatible failure.");
  }
  const deviationThreshold = evidence.baselineMean + Math.max(2, evidence.baselineStddev * 2);
  const historicalDeviation = evidence.baselineWindows >= 8 && evidence.distinctReporters >= deviationThreshold;
  if (historicalDeviation) {
    score += 15;
    reasons.push(`Current activity exceeds the ${evidence.baselineWindows}-window historical baseline threshold.`);
  } else if (evidence.baselineWindows < 8) {
    reasons.push("The regional historical baseline is not mature enough to raise confidence.");
  }

  const likely = evidence.distinctReporters >= AREA_PULSE_LIKELY_REPORTS && (historicalDeviation || evidence.multiDestinationCorroborated);
  return { level: likely ? "likely" : "possible", score: Math.min(likely ? 94 : 74, Math.round(score)), reasons };
}

export function isAreaReportKind(value: unknown): value is AreaReportKind {
  return typeof value === "string" && ["complete_outage", "intermittent", "slow_speed", "high_latency", "dns_problem", "service_unavailable"].includes(value);
}

export function areaReportLabel(kind: AreaReportKind): string {
  return {
    complete_outage: "Complete outage",
    intermittent: "Intermittent connection",
    slow_speed: "Slow speed",
    high_latency: "High latency",
    dns_problem: "DNS problem",
    service_unavailable: "Specific service unavailable",
  }[kind];
}

export function parseAreaPulseContext(value: unknown): AreaPulseContext | null {
  if (!isRecord(value) || typeof value.available !== "boolean" || typeof value.reportingAvailable !== "boolean") return null;
  if (value.reason !== null && typeof value.reason !== "string") return null;
  if (value.turnstileSiteKey !== null && typeof value.turnstileSiteKey !== "string") return null;
  if (typeof value.retentionDays !== "number" || typeof value.minimumReports !== "number" || typeof value.locationNotice !== "string") return null;
  const region = value.region === null ? null : parseRegion(value.region);
  if (value.region !== null && region === null) return null;
  return { available: value.available, reportingAvailable: value.reportingAvailable, reason: value.reason, region, turnstileSiteKey: value.turnstileSiteKey, retentionDays: value.retentionDays, minimumReports: value.minimumReports, locationNotice: value.locationNotice };
}

export function parseAreaPulseSnapshot(value: unknown): AreaPulseSnapshot | null {
  if (!isRecord(value) || typeof value.generatedAt !== "string" || !Array.isArray(value.incidents) || !Array.isArray(value.officialMessages) || !Array.isArray(value.limitations)) return null;
  const region = value.region === null ? null : parseRegion(value.region);
  if (value.region !== null && region === null) return null;
  if (!value.incidents.every(isIncident) || !value.officialMessages.every(isOfficialMessage) || !value.limitations.every((item) => typeof item === "string") || !isOutcome(value.outcome)) return null;
  return { generatedAt: value.generatedAt, region, incidents: value.incidents, officialMessages: value.officialMessages, outcome: value.outcome, limitations: value.limitations };
}

function parseRegion(value: unknown): CoarseRegion | null {
  if (!isRecord(value) || typeof value.key !== "string" || typeof value.label !== "string" || typeof value.countryCode !== "string" || value.approximate !== true) return null;
  if (value.level !== "city" && value.level !== "subdivision" && value.level !== "country") return null;
  return { key: value.key, label: value.label, countryCode: value.countryCode, level: value.level, approximate: true };
}

function isIncident(value: unknown): value is AreaPulseIncident {
  return isRecord(value) && typeof value.id === "string" && typeof value.isp === "string" && (value.asn === null || typeof value.asn === "string") && parseRegion(value.region) !== null && typeof value.startedAt === "string" && typeof value.lastObservedAt === "string" && typeof value.expiresAt === "string" && Array.isArray(value.affectedServices) && value.affectedServices.every((item) => typeof item === "string") && typeof value.reportCount === "number" && typeof value.distinctReporters === "number" && isConfidence(value.confidence) && typeof value.confidenceScore === "number" && Array.isArray(value.confidenceReasons) && value.confidenceReasons.every((item) => typeof item === "string") && isStatus(value.status) && Array.isArray(value.sources) && value.sources.every(isSource);
}

function isOfficialMessage(value: unknown): value is OfficialProviderMessage {
  return isRecord(value) && typeof value.id === "string" && typeof value.isp === "string" && (value.asn === null || typeof value.asn === "string") && (value.region === null || parseRegion(value.region) !== null) && typeof value.title === "string" && typeof value.message === "string" && isStatus(value.status) && typeof value.publishedAt === "string" && typeof value.expiresAt === "string" && typeof value.sourceUrl === "string" && typeof value.sourceLabel === "string" && value.official === true;
}

function isSource(value: unknown): value is AreaPulseSource {
  return isRecord(value) && ["crowd", "official-provider", "independent-check", "historical-baseline"].includes(String(value.kind)) && typeof value.label === "string" && typeof value.observedAt === "string" && (value.url === null || typeof value.url === "string") && typeof value.official === "boolean";
}

function isConfidence(value: unknown): value is IncidentConfidence {
  return value === "insufficient" || value === "possible" || value === "likely" || value === "official";
}

function isStatus(value: unknown): value is IncidentStatus {
  return value === "active" || value === "monitoring" || value === "resolved";
}

function isOutcome(value: unknown): value is AreaPulseOutcome {
  return typeof value === "string" && ["possible-device-problem", "possible-local-network-problem", "isp-connection-degraded", "possible-regional-disruption", "destination-specific-problem", "general-internet-incident", "no-regional-incident", "insufficient-evidence"].includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
