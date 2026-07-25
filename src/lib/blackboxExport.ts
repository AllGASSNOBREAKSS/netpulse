import {
  analyzeLagMarker,
  monitoringLimitations,
  summarizeBlackBoxSession,
  type BlackBoxSession,
  type SessionSummary,
} from "./blackbox";

export type BlackBoxSupportReport = {
  tool: "NetPulse Connection Black Box";
  schemaVersion: number;
  session: {
    id: string;
    mode: string;
    startedAt: string;
    endedAt: string | null;
    status: string;
    targetDurationMs: number;
    actualPayloadBytes: number;
  };
  networkIdentity: {
    isp: string | null;
    asn: string | null;
    approximateRegion: string | null;
    source: string | null;
    fullPublicIpIncluded: false;
  };
  endpoints: {
    primary: string;
    secondary: string;
    dns: string;
    persistentEcho: "unavailable";
    packetLoss: "unavailable";
  };
  summary: SessionSummary;
  userLagEvents: ReturnType<typeof analyzeLagMarker>[];
  browserConditions: {
    visibilityChanges: BlackBoxSession["visibility"];
    schedulingDelayCount: number;
  };
  methodology: string[];
  limitations: string[];
  responsibilityStatement: string;
};

export type SharedBlackBoxSummary = {
  version: 2;
  generatedAt: string;
  expiresAt: string;
  timeframe: { startedAt: string; endedAt: string | null; mode: string };
  quality: { score: number; label: string; confidence: number };
  latency: SessionSummary["latency"];
  stablePercent: number;
  degradedPercent: number;
  interruptionPercent: number;
  incidentCount: number;
  incidents: Array<{ type: string; severity: string; durationMs: number; evidence: string }>;
  lagEvents: string[];
  limitations: string[];
  privacy: "No public IP, exact location, raw samples, SSID, device name, or payload contents are included.";
};

export function buildBlackBoxExport(session: BlackBoxSession) {
  return {
    ...buildSupportReportData(session),
    raw: {
      samples: session.samples,
      dns: session.dns,
      endpointObservations: session.endpoints,
      lagMarkers: session.lagMarkers,
    },
  };
}

export function buildSupportReportData(session: BlackBoxSession): BlackBoxSupportReport {
  const summary = summarizeBlackBoxSession(session);
  return {
    tool: "NetPulse Connection Black Box",
    schemaVersion: session.schemaVersion,
    session: {
      id: session.id,
      mode: session.mode.label,
      startedAt: new Date(session.startedAt).toISOString(),
      endedAt: session.endedAt === null ? null : new Date(session.endedAt).toISOString(),
      status: session.status,
      targetDurationMs: session.mode.durationMs,
      actualPayloadBytes: session.dataReceivedBytes,
    },
    networkIdentity: {
      isp: session.identity?.isp ?? null,
      asn: session.identity?.asn ?? null,
      approximateRegion: session.identity?.approximateRegion ?? null,
      source: session.identity?.source ?? null,
      fullPublicIpIncluded: false,
    },
    endpoints: {
      primary: "Cloudflare speed endpoint, zero-byte HTTPS response",
      secondary: session.secondaryEndpointConfigured ? "Configured independent HTTPS endpoint" : "unavailable",
      dns: "Cloudflare DNS over HTTPS controlled transaction; includes HTTPS transport",
      persistentEcho: "unavailable",
      packetLoss: "unavailable",
    },
    summary,
    userLagEvents: session.lagMarkers.map((marker) => analyzeLagMarker(session, marker)),
    browserConditions: {
      visibilityChanges: session.visibility,
      schedulingDelayCount: summary.schedulingDelayCount,
    },
    methodology: [
      "Latency and reachability use repeated cache-busted zero-byte HTTPS requests timed with performance.now().",
      "Jitter is the mean absolute difference between consecutive successful primary-endpoint latency samples.",
      "P50, P95, and P99 use linearly interpolated percentiles over successful samples.",
      "Browser scheduling delay is measured separately from request duration and is never counted as packet loss.",
      "Incidents are deterministic threshold/grouping results. They identify observed symptoms and endpoints, not ISP ownership.",
    ],
    limitations: monitoringLimitations(session),
    responsibilityStatement: "This report does not assign responsibility to an ISP, router, Wi-Fi link, application, or device without independent supporting evidence.",
  };
}

export function buildSharedBlackBoxSummary(session: BlackBoxSession): SharedBlackBoxSummary {
  const summary = summarizeBlackBoxSession(session);
  return {
    version: 2,
    generatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    timeframe: {
      startedAt: new Date(session.startedAt).toISOString(),
      endedAt: session.endedAt === null ? null : new Date(session.endedAt).toISOString(),
      mode: session.mode.label,
    },
    quality: { score: summary.qualityScore, label: summary.qualityLabel, confidence: summary.confidence },
    latency: summary.latency,
    stablePercent: summary.stablePercent,
    degradedPercent: summary.degradedPercent,
    interruptionPercent: summary.interruptionPercent,
    incidentCount: summary.incidents.length,
    incidents: summary.incidents.slice(0, 20).map((incident) => ({
      type: incident.type,
      severity: incident.severity,
      durationMs: incident.durationMs,
      evidence: incident.evidence[0] ?? "No additional evidence.",
    })),
    lagEvents: session.lagMarkers.map((marker) => analyzeLagMarker(session, marker).statement),
    limitations: monitoringLimitations(session),
    privacy: "No public IP, exact location, raw samples, SSID, device name, or payload contents are included.",
  };
}

export function createPrivacySafeShareUrl(session: BlackBoxSession, baseUrl = browserBaseUrl()): string {
  const encoded = encodeBase64Url(JSON.stringify(buildSharedBlackBoxSummary(session)));
  const url = new URL(baseUrl);
  url.hash = `blackbox=${encoded}`;
  return url.toString();
}

export function parsePrivacySafeShare(hash: string, now = Date.now()): SharedBlackBoxSummary | null {
  const encoded = hash.startsWith("#blackbox=") ? hash.slice("#blackbox=".length) : null;
  if (!encoded) return null;
  try {
    const parsed: unknown = JSON.parse(decodeBase64Url(encoded));
    return isSharedSummary(parsed) && Date.parse(parsed.expiresAt) > now ? parsed : null;
  } catch {
    return null;
  }
}

export function downloadBlackBoxJson(session: BlackBoxSession): void {
  downloadBlob(JSON.stringify(buildBlackBoxExport(session), null, 2), "application/json", filename(session, "json"));
}

export function downloadBlackBoxCsv(session: BlackBoxSession): void {
  downloadBlob(createBlackBoxCsv(session), "text/csv;charset=utf-8", filename(session, "csv"));
}

export function createBlackBoxCsv(session: BlackBoxSession): string {
  const rows = [
    ["scheduled_at", "started_at", "completed_at", "scheduling_delay_ms", "visibility", "primary_status", "latency_ms", "secondary_status", "primary_bytes", "secondary_bytes"],
    ...session.samples.map((sample) => [
      new Date(sample.scheduledAt).toISOString(),
      new Date(sample.startedAt).toISOString(),
      new Date(sample.completedAt).toISOString(),
      sample.schedulingDelayMs,
      sample.visibility,
      sample.primary.status,
      sample.primary.durationMs ?? "",
      sample.secondary.status,
      sample.primary.bytesReceived,
      sample.secondary.bytesReceived,
    ]),
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function downloadSupportReportJson(session: BlackBoxSession): void {
  downloadBlob(JSON.stringify(buildSupportReportData(session), null, 2), "application/json", filename(session, "support-report.json"));
}

export function createSupportReportText(session: BlackBoxSession): string {
  const report = buildSupportReportData(session);
  const summary = report.summary;
  const lines = [
    "NetPulse Connection Black Box support report",
    `Session: ${report.session.startedAt} to ${report.session.endedAt ?? "in progress"}`,
    `Mode: ${report.session.mode} · status ${report.session.status}`,
    `ISP: ${report.networkIdentity.isp ?? "unavailable"} · ASN: ${report.networkIdentity.asn ?? "unavailable"} · approximate region: ${report.networkIdentity.approximateRegion ?? "unavailable"}`,
    "",
    `Quality: ${summary.qualityLabel} (${summary.qualityScore}/100) · confidence ${summary.confidence}%`,
    `Latency: min ${format(summary.latency.min)} ms · median ${format(summary.latency.median)} ms · mean ${format(summary.latency.mean)} ms · P95 ${format(summary.latency.p95)} ms · P99 ${format(summary.latency.p99)} ms`,
    `Jitter: ${format(summary.latency.jitter)} ms · samples ${summary.sampleCount} · reachability failures ${summary.reachabilityFailures}`,
    `Stable ${summary.stablePercent.toFixed(1)}% · degraded ${summary.degradedPercent.toFixed(1)}% · interruption ${summary.interruptionPercent.toFixed(1)}%`,
    `Incidents: ${summary.incidents.length} · DNS failures ${summary.dnsFailures} · endpoint changes ${summary.endpointChanges} · browser scheduling delays ${summary.schedulingDelayCount}`,
    "",
    "Incident timeline",
    ...(summary.incidents.length ? summary.incidents.map((incident) => `- ${new Date(incident.startAt).toISOString()} ${incident.title} (${incident.severity}, ${incident.confidence}% confidence): ${incident.evidence.join(" ")}`) : ["- No threshold-defined incidents were detected."]),
    "",
    "User lag markers",
    ...(report.userLagEvents.length ? report.userLagEvents.map((event) => `- ${event.statement}`) : ["- None recorded."]),
    "",
    "Limitations",
    ...report.limitations.map((item) => `- ${item}`),
    "",
    report.responsibilityStatement,
    "Full public IP included: no.",
  ];
  return lines.join("\r\n");
}

export function downloadSupportReportText(session: BlackBoxSession): void {
  downloadBlob(createSupportReportText(session), "text/plain;charset=utf-8", filename(session, "support-report.txt"));
}

function filename(session: BlackBoxSession, extension: string): string {
  const stamp = new Date(session.startedAt).toISOString().replace(/[:.]/g, "-");
  return `netpulse-blackbox-${stamp}.${extension}`;
}

function downloadBlob(contents: string, type: string, name: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeBase64Url(value: string): string {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

function browserBaseUrl(): string {
  return typeof location === "undefined" ? "https://netpulse.invalid/" : `${location.origin}${location.pathname}`;
}

function isSharedSummary(value: unknown): value is SharedBlackBoxSummary {
  if (!isRecord(value) || value.version !== 2 || !isRecord(value.timeframe) || !isRecord(value.quality) || !isRecord(value.latency)) return false;
  return typeof value.generatedAt === "string" && typeof value.expiresAt === "string" && Number.isFinite(Date.parse(value.expiresAt)) && typeof value.timeframe.startedAt === "string" &&
    typeof value.timeframe.mode === "string" && typeof value.quality.score === "number" &&
    typeof value.quality.label === "string" && typeof value.quality.confidence === "number" &&
    Array.isArray(value.incidents) && Array.isArray(value.lagEvents) && Array.isArray(value.limitations) &&
    typeof value.privacy === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function format(value: number): string {
  return value >= 100 ? String(Math.round(value)) : value.toFixed(1);
}
