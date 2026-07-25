import { jitter, max, mean, median, min, percentile } from "./stats";

export const BLACK_BOX_SCHEMA_VERSION = 1;
export const BLACK_BOX_MAX_CUSTOM_MINUTES = 480;
export const BLACK_BOX_MIN_CUSTOM_MINUTES = 5;

export type MonitorModeId = "quick" | "gaming" | "video-call" | "work" | "evening" | "custom";
export type MonitorStatus = "running" | "paused" | "completed" | "stopped" | "interrupted";
export type VisibilityState = "visible" | "hidden" | "prerender" | "unknown";

export type MonitorMode = {
  id: MonitorModeId;
  label: string;
  description: string;
  durationMs: number;
  probeIntervalMs: number;
  dnsIntervalMs: number;
  traceIntervalMs: number;
  estimatedPayloadBytes: number;
};

export const MONITOR_MODES: readonly MonitorMode[] = [
  mode("quick", "Five-minute quick scan", "A fast stability check with two-second reachability and latency probes.", 5, 2_000, 30_000, 60_000),
  mode("gaming", "Thirty-minute gaming monitor", "One-second probes prioritize short latency and jitter incidents.", 30, 1_000, 30_000, 60_000),
  mode("video-call", "One-hour video-call monitor", "Two-second probes balance call-quality evidence and resource use.", 60, 2_000, 45_000, 90_000),
  mode("work", "Work-session monitor", "Two hours of five-second probes for intermittent workday issues.", 120, 5_000, 90_000, 180_000),
  mode("evening", "Evening congestion monitor", "Four hours of ten-second probes for time-of-day patterns.", 240, 10_000, 120_000, 300_000),
];

export type EndpointResult = {
  status: "ok" | "failed" | "unavailable";
  durationMs: number | null;
  bytesReceived: number;
  detail: string;
};

export type BlackBoxSample = {
  id: string;
  scheduledAt: number;
  startedAt: number;
  completedAt: number;
  schedulingDelayMs: number;
  visibility: VisibilityState;
  primary: EndpointResult;
  secondary: EndpointResult;
};

export type DnsObservation = {
  id: string;
  measuredAt: number;
  status: "ok" | "failed";
  durationMs: number | null;
  responseCode: number | null;
  bytesReceived: number;
  provider: "Cloudflare DNS over HTTPS";
  detail: string;
};

export type EndpointObservation = {
  id: string;
  measuredAt: number;
  edgeCode: string | null;
  observedIpFamily: "IPv4" | "IPv6" | "unknown";
  ipv4: EndpointResult;
  ipv6: EndpointResult;
  bytesReceived: number;
};

export type VisibilityEvent = {
  id: string;
  at: number;
  state: VisibilityState;
};

export type LagMarker = {
  id: string;
  at: number;
  note: string | null;
};

export type SessionIdentity = {
  isp: string | null;
  asn: string | null;
  approximateRegion: string | null;
  source: "ipwho.is";
};

export type BlackBoxSession = {
  schemaVersion: typeof BLACK_BOX_SCHEMA_VERSION;
  id: string;
  mode: MonitorMode;
  createdAt: number;
  startedAt: number;
  endedAt: number | null;
  status: MonitorStatus;
  pausedDurationMs: number;
  pauseStartedAt: number | null;
  samples: BlackBoxSample[];
  dns: DnsObservation[];
  endpoints: EndpointObservation[];
  visibility: VisibilityEvent[];
  lagMarkers: LagMarker[];
  dataReceivedBytes: number;
  identity: SessionIdentity | null;
  secondaryEndpointConfigured: boolean;
  storageWarning: string | null;
};

export type IncidentType =
  | "latency-spike"
  | "severe-jitter"
  | "reachability-interruption"
  | "dns-failure"
  | "endpoint-specific-failure"
  | "browser-suspension"
  | "insufficient-evidence";

export type BlackBoxIncident = {
  id: string;
  type: IncidentType;
  title: string;
  startAt: number;
  endAt: number;
  durationMs: number;
  severity: "low" | "medium" | "high" | "critical";
  evidence: string[];
  confidence: number;
  affectedEndpoint: string;
  possibleImpact: string;
};

export type ConfidenceFactor = {
  label: string;
  score: number;
  weight: number;
  evidence: string;
};

export type SessionSummary = {
  latency: { min: number; median: number; mean: number; p95: number; p99: number; jitter: number };
  sampleCount: number;
  successfulSamples: number;
  reachabilityFailures: number;
  interruptionCount: number;
  longestInterruptionMs: number;
  spikeCount: number;
  spikeDurationMs: number;
  longestSpikeMs: number;
  dnsFailures: number;
  endpointChanges: number;
  schedulingDelayCount: number;
  stablePercent: number;
  degradedPercent: number;
  interruptionPercent: number;
  confidence: number;
  confidenceFactors: ConfidenceFactor[];
  qualityScore: number;
  qualityLabel: string;
  incidents: BlackBoxIncident[];
  worstIncident: BlackBoxIncident | null;
  bestWindow: TimeWindowSummary | null;
  worstWindow: TimeWindowSummary | null;
};

export type TimeWindowSummary = {
  startAt: number;
  endAt: number;
  medianLatencyMs: number;
  successfulSamples: number;
};

export type LagAnalysis = {
  marker: LagMarker;
  statement: string;
  evidence: string[];
  confidence: number;
  incidents: BlackBoxIncident[];
};

export function customMonitorMode(minutes: number): MonitorMode {
  const safeMinutes = Math.min(BLACK_BOX_MAX_CUSTOM_MINUTES, Math.max(BLACK_BOX_MIN_CUSTOM_MINUTES, Math.round(minutes)));
  const probeIntervalMs = safeMinutes <= 30 ? 2_000 : safeMinutes <= 120 ? 5_000 : 10_000;
  const dnsIntervalMs = safeMinutes <= 60 ? 45_000 : 120_000;
  const traceIntervalMs = safeMinutes <= 60 ? 90_000 : 300_000;
  return mode("custom", `${safeMinutes}-minute custom monitor`, "A bounded custom session using the same lightweight evidence probes.", safeMinutes, probeIntervalMs, dnsIntervalMs, traceIntervalMs);
}

export function createBlackBoxSession(selectedMode: MonitorMode, secondaryEndpointConfigured: boolean, now = Date.now()): BlackBoxSession {
  return {
    schemaVersion: BLACK_BOX_SCHEMA_VERSION,
    id: `blackbox-${now.toString(36)}-${sessionNonce()}`,
    mode: selectedMode,
    createdAt: now,
    startedAt: now,
    endedAt: null,
    status: "running",
    pausedDurationMs: 0,
    pauseStartedAt: null,
    samples: [],
    dns: [],
    endpoints: [],
    visibility: [{ id: `visibility-${now}`, at: now, state: currentVisibility() }],
    lagMarkers: [],
    dataReceivedBytes: 0,
    identity: null,
    secondaryEndpointConfigured,
    storageWarning: null,
  };
}

export function activeElapsedMs(session: BlackBoxSession, now = Date.now()): number {
  const end = session.endedAt ?? now;
  const currentPause = session.pauseStartedAt === null ? 0 : Math.max(0, end - session.pauseStartedAt);
  return Math.max(0, end - session.startedAt - session.pausedDurationMs - currentPause);
}

export function remainingMs(session: BlackBoxSession, now = Date.now()): number {
  return Math.max(0, session.mode.durationMs - activeElapsedMs(session, now));
}

export function summarizeBlackBoxSession(session: BlackBoxSession): SessionSummary {
  const successful = session.samples.filter((sample) => sample.primary.status === "ok" && sample.primary.durationMs !== null);
  const rtts = successful.map((sample) => sample.primary.durationMs ?? 0);
  const incidents = classifyIncidents(session);
  const interruptionIncidents = incidents.filter((incident) => incident.type === "reachability-interruption");
  const spikeIncidents = incidents.filter((incident) => incident.type === "latency-spike");
  const endpointEdges = session.endpoints.map((item) => item.edgeCode).filter((edge): edge is string => Boolean(edge));
  const endpointChanges = endpointEdges.slice(1).filter((edge, index) => edge !== endpointEdges[index]).length;
  const schedulingDelayCount = session.samples.filter((sample) => isSchedulingDelay(sample, session.mode.probeIntervalMs)).length;
  const baseline = median(rtts);
  const latencyThreshold = spikeThreshold(baseline);
  const degraded = successful.filter((sample) =>
    (sample.primary.durationMs ?? 0) >= latencyThreshold || isSchedulingDelay(sample, session.mode.probeIntervalMs),
  ).length;
  const failures = session.samples.length - successful.length;
  const stable = Math.max(0, successful.length - degraded);
  const denominator = Math.max(1, session.samples.length);
  const confidenceFactors = computeConfidenceFactors(session);
  const confidence = Math.round(100 * confidenceFactors.reduce((sum, factor) => sum + factor.score * factor.weight, 0));
  const stablePercent = percent(stable, denominator);
  const degradedPercent = percent(degraded, denominator);
  const interruptionPercent = percent(failures, denominator);
  const qualityScore = Math.round(
    clamp(stablePercent / 100, 0, 1) * 35 +
      latencyQuality(percentile(rtts, 95)) * 20 +
      jitterQuality(jitter(rtts)) * 15 +
      clamp(1 - interruptionPercent / 10, 0, 1) * 15 +
      (confidence / 100) * 15,
  );
  const windows = calculateTimeWindows(session, 30_000);

  return {
    latency: {
      min: min(rtts),
      median: baseline,
      mean: mean(rtts),
      p95: percentile(rtts, 95),
      p99: percentile(rtts, 99),
      jitter: jitter(rtts),
    },
    sampleCount: session.samples.length,
    successfulSamples: successful.length,
    reachabilityFailures: failures,
    interruptionCount: interruptionIncidents.length,
    longestInterruptionMs: max(interruptionIncidents.map((incident) => incident.durationMs)),
    spikeCount: spikeIncidents.length,
    spikeDurationMs: spikeIncidents.reduce((sum, incident) => sum + incident.durationMs, 0),
    longestSpikeMs: max(spikeIncidents.map((incident) => incident.durationMs)),
    dnsFailures: session.dns.filter((sample) => sample.status === "failed").length,
    endpointChanges,
    schedulingDelayCount,
    stablePercent,
    degradedPercent,
    interruptionPercent,
    confidence,
    confidenceFactors,
    qualityScore,
    qualityLabel: qualityLabel(qualityScore),
    incidents,
    worstIncident: [...incidents].sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.durationMs - a.durationMs)[0] ?? null,
    bestWindow: windows.length ? [...windows].sort((a, b) => a.medianLatencyMs - b.medianLatencyMs)[0] : null,
    worstWindow: windows.length ? [...windows].sort((a, b) => b.medianLatencyMs - a.medianLatencyMs)[0] : null,
  };
}

export function classifyIncidents(session: BlackBoxSession): BlackBoxIncident[] {
  if (session.samples.length === 0) return [];
  const successfulRtts = session.samples
    .filter((sample) => sample.primary.status === "ok" && sample.primary.durationMs !== null)
    .map((sample) => sample.primary.durationMs ?? 0);
  const baseline = median(successfulRtts);
  const threshold = spikeThreshold(baseline);
  const incidents: BlackBoxIncident[] = [];

  incidents.push(...groupSampleIncidents(
    session,
    session.samples.filter((sample) => sample.primary.status === "ok" && (sample.primary.durationMs ?? 0) >= threshold),
    "latency-spike",
    "Latency spike",
    (group) => {
      const values = group.map((sample) => sample.primary.durationMs ?? 0);
      return [`Latency reached ${Math.round(max(values))} ms; the session baseline was ${Math.round(baseline)} ms and the spike threshold was ${Math.round(threshold)} ms.`];
    },
    "Real-time calls, games, and interactive browsing may have stalled.",
    "Primary Cloudflare HTTPS probe",
  ));

  const severeJitterThreshold = Math.max(50, baseline * 2);
  const jitterEvents = session.samples.filter((sample, index, samples) => {
    if (index === 0 || sample.primary.durationMs === null || samples[index - 1].primary.durationMs === null) return false;
    return Math.abs(sample.primary.durationMs - (samples[index - 1].primary.durationMs ?? 0)) >= severeJitterThreshold;
  });
  incidents.push(...groupSampleIncidents(
    session,
    jitterEvents,
    "severe-jitter",
    "Severe jitter",
    (group) => [`${group.length} abrupt consecutive-latency change(s) exceeded the session jitter threshold.`],
    "Audio may sound robotic and game timing may become inconsistent.",
    "Primary Cloudflare HTTPS probe",
  ));

  incidents.push(...groupSampleIncidents(
    session,
    session.samples.filter((sample) => sample.primary.status === "failed"),
    "reachability-interruption",
    "Primary endpoint interruption",
    (group) => [`${group.length} consecutive HTTPS reachability probe(s) failed. This is not a packet-loss percentage and does not prove the whole internet connection was down.`],
    "Traffic using the same route may have stalled; independent endpoint evidence is required for a general outage claim.",
    "Primary Cloudflare HTTPS probe",
  ));

  for (const item of session.dns.filter((sample) => sample.status === "failed")) {
    incidents.push(incident(
      "dns-failure",
      "Controlled DNS transaction failed",
      item.measuredAt,
      item.measuredAt,
      "medium",
      [item.detail, "This measures a DNS-over-HTTPS transaction, not the operating system's configured resolver."],
      65,
      item.provider,
      "New hostname lookups through this controlled resolver path may have failed or slowed.",
    ));
  }

  for (const sample of session.samples) {
    if (sample.secondary.status === "unavailable") continue;
    if (sample.primary.status !== sample.secondary.status) {
      const failed = sample.primary.status === "failed" ? "primary" : "secondary";
      incidents.push(incident(
        "endpoint-specific-failure",
        "Endpoint-specific reachability failure",
        sample.startedAt,
        sample.completedAt,
        "medium",
        [`The ${failed} endpoint failed while the other configured endpoint responded.`],
        80,
        failed === "primary" ? "Primary Cloudflare endpoint" : "Configured secondary endpoint",
        "Some destinations or routes may have been affected while general connectivity remained available.",
      ));
    }
  }

  const scheduling = session.samples.filter((sample) => isSchedulingDelay(sample, session.mode.probeIntervalMs));
  incidents.push(...groupSampleIncidents(
    session,
    scheduling,
    "browser-suspension",
    "Browser scheduling suspension",
    (group) => [`The browser started ${group.length} probe(s) more than ${Math.round(session.mode.probeIntervalMs * 1.5)} ms late; the largest delay was ${Math.round(max(group.map((sample) => sample.schedulingDelayMs)))} ms.`],
    "The monitoring tab may have been backgrounded, throttled, or the device may have slept; network state during the gap is unknown.",
    "Browser scheduler",
  ));

  return incidents.sort((a, b) => a.startAt - b.startAt || severityRank(b.severity) - severityRank(a.severity));
}

export function analyzeLagMarker(session: BlackBoxSession, marker: LagMarker): LagAnalysis {
  const windowStart = marker.at - 15_000;
  const windowEnd = marker.at + 15_000;
  const summary = summarizeBlackBoxSession(session);
  const related = summary.incidents.filter((item) => item.endAt >= windowStart && item.startAt <= windowEnd);
  const nearSamples = session.samples.filter((sample) => sample.startedAt >= windowStart && sample.startedAt <= windowEnd);
  const failures = nearSamples.filter((sample) => sample.primary.status === "failed").length;
  const visible = nearSamples.filter((sample) => sample.visibility === "visible").length;
  const foregroundText = nearSamples.length > 0 && visible === nearSamples.length
    ? "The browser remained in the foreground."
    : `${nearSamples.length - visible} nearby sample(s) were collected while the page was not visible.`;

  if (related.length === 0) {
    return {
      marker,
      statement: "No measurable network anomaly was detected around this event.",
      evidence: [`${nearSamples.length} probe(s) fell within the 30-second analysis window.`, foregroundText],
      confidence: nearSamples.length >= 4 ? summary.confidence : Math.min(summary.confidence, 45),
      incidents: [],
    };
  }

  const main = [...related].sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.durationMs - a.durationMs)[0];
  const statement = `At ${formatClock(marker.at)}, ${main.title.toLowerCase()} was observed for ${formatDuration(main.durationMs)}. ${failures > 0 ? `${failures} primary reachability failure(s) occurred in the surrounding window. ` : ""}${foregroundText}`;
  return {
    marker,
    statement,
    evidence: related.flatMap((item) => item.evidence),
    confidence: Math.min(summary.confidence, max(related.map((item) => item.confidence))),
    incidents: related,
  };
}

export function monitoringLimitations(session: BlackBoxSession): string[] {
  const limitations = [
    "Packet loss is unavailable because NetPulse has no cooperating UDP echo or TURN measurement service. Failed HTTPS probes are reachability failures, not lost-packet percentages.",
    "Controlled DNS timing uses Cloudflare DNS over HTTPS and includes HTTPS transport. It does not measure the operating system's configured resolver in isolation.",
    "Browser timers can be delayed by background throttling, device sleep, CPU pressure, or power saving. Scheduling delay and visibility are recorded so those gaps are not attributed to the network.",
    "Lightweight probes do not measure upload- or download-related degradation and do not identify Wi-Fi signal, router state, or ISP ownership.",
    "Application response payload is counted; HTTP/TLS/IP overhead and radio energy use are unavailable to browser JavaScript.",
  ];
  if (!session.secondaryEndpointConfigured) limitations.push("No independent secondary endpoint is configured, so one-endpoint failures cannot establish general connection loss or route-specific degradation.");
  limitations.push("Persistent echo monitoring is unavailable because no NetPulse WebSocket/WebTransport echo service is deployed.");
  return limitations;
}

function computeConfidenceFactors(session: BlackBoxSession): ConfidenceFactor[] {
  const elapsed = Math.max(session.mode.probeIntervalMs, activeElapsedMs(session, session.endedAt ?? Date.now()));
  const expected = Math.max(1, Math.floor(elapsed / session.mode.probeIntervalMs));
  const sampling = clamp(session.samples.length / expected, 0, 1);
  const onTime = session.samples.filter((sample) => !isSchedulingDelay(sample, session.mode.probeIntervalMs)).length;
  const scheduling = session.samples.length ? onTime / session.samples.length : 0;
  const foreground = session.samples.length ? session.samples.filter((sample) => sample.visibility === "visible").length / session.samples.length : 0;
  const dnsExpected = Math.max(1, Math.floor(elapsed / session.mode.dnsIntervalMs));
  const endpointCoverage = clamp(session.dns.length / dnsExpected, 0, 1);
  const completion = session.status === "completed" ? 1 : session.status === "stopped" ? 0.75 : session.status === "running" || session.status === "paused" ? 0.6 : 0.35;
  return [
    { label: "Probe completeness", score: sampling, weight: 0.35, evidence: `${session.samples.length} of approximately ${expected} active-time probes recorded.` },
    { label: "Browser scheduling", score: scheduling, weight: 0.25, evidence: `${onTime} of ${session.samples.length} probes started within the scheduling-delay threshold.` },
    { label: "Foreground coverage", score: foreground, weight: 0.15, evidence: `${Math.round(foreground * 100)}% of probes started while the page was visible.` },
    { label: "Supporting endpoint coverage", score: endpointCoverage, weight: 0.1, evidence: `${session.dns.length} controlled DNS observation(s) recorded.` },
    { label: "Session completion", score: completion, weight: 0.15, evidence: `Session status: ${session.status}.` },
  ];
}

function groupSampleIncidents(
  session: BlackBoxSession,
  selected: BlackBoxSample[],
  type: IncidentType,
  title: string,
  evidence: (samples: BlackBoxSample[]) => string[],
  possibleImpact: string,
  affectedEndpoint: string,
): BlackBoxIncident[] {
  if (selected.length === 0) return [];
  const ids = new Set(selected.map((sample) => sample.id));
  const groups: BlackBoxSample[][] = [];
  let current: BlackBoxSample[] = [];
  for (const sample of session.samples) {
    if (ids.has(sample.id)) {
      if (current.length > 0 && sample.scheduledAt - current[current.length - 1].scheduledAt > session.mode.probeIntervalMs * 2.5) {
        groups.push(current);
        current = [];
      }
      current.push(sample);
    } else if (current.length > 0) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length > 0) groups.push(current);

  return groups.map((group) => {
    const start = group[0].scheduledAt;
    const end = Math.max(group[group.length - 1].completedAt, start + session.mode.probeIntervalMs);
    const duration = end - start;
    const severity = incidentSeverity(type, group.length, duration, max(group.map((sample) => sample.primary.durationMs ?? 0)));
    const visibleRatio = group.filter((sample) => sample.visibility === "visible").length / group.length;
    const scheduleRatio = group.filter((sample) => !isSchedulingDelay(sample, session.mode.probeIntervalMs)).length / group.length;
    const confidence = Math.round(100 * Math.min(0.95, 0.45 + visibleRatio * 0.25 + scheduleRatio * 0.2 + Math.min(group.length / 10, 0.1)));
    return incident(type, title, start, end, severity, evidence(group), confidence, affectedEndpoint, possibleImpact);
  });
}

function incident(
  type: IncidentType,
  title: string,
  startAt: number,
  endAt: number,
  severity: BlackBoxIncident["severity"],
  evidence: string[],
  confidence: number,
  affectedEndpoint: string,
  possibleImpact: string,
): BlackBoxIncident {
  return {
    id: `${type}-${startAt}-${endAt}`,
    type,
    title,
    startAt,
    endAt,
    durationMs: Math.max(0, endAt - startAt),
    severity,
    evidence,
    confidence,
    affectedEndpoint,
    possibleImpact,
  };
}

function calculateTimeWindows(session: BlackBoxSession, windowMs: number): TimeWindowSummary[] {
  const successful = session.samples.filter((sample) => sample.primary.status === "ok" && sample.primary.durationMs !== null);
  if (successful.length < 2) return [];
  const windows: TimeWindowSummary[] = [];
  let start = successful[0].startedAt;
  const end = successful[successful.length - 1].completedAt;
  while (start <= end) {
    const values = successful.filter((sample) => sample.startedAt >= start && sample.startedAt < start + windowMs);
    if (values.length >= 2) {
      windows.push({
        startAt: start,
        endAt: start + windowMs,
        medianLatencyMs: median(values.map((sample) => sample.primary.durationMs ?? 0)),
        successfulSamples: values.length,
      });
    }
    start += windowMs;
  }
  return windows;
}

function mode(id: MonitorModeId, label: string, description: string, minutes: number, probeIntervalMs: number, dnsIntervalMs: number, traceIntervalMs: number): MonitorMode {
  const durationMs = minutes * 60_000;
  const primaryProbes = Math.ceil(durationMs / probeIntervalMs);
  const dnsProbes = Math.ceil(durationMs / dnsIntervalMs);
  const traceProbes = Math.ceil(durationMs / traceIntervalMs);
  return {
    id,
    label,
    description,
    durationMs,
    probeIntervalMs,
    dnsIntervalMs,
    traceIntervalMs,
    estimatedPayloadBytes: primaryProbes * 16 + dnsProbes * 1_200 + traceProbes * 900,
  };
}

function sessionNonce(): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0].toString(36);
}

function currentVisibility(): VisibilityState {
  if (typeof document === "undefined") return "unknown";
  return normalizeVisibility(document.visibilityState);
}

export function normalizeVisibility(value: string): VisibilityState {
  return value === "visible" || value === "hidden" || value === "prerender" ? value : "unknown";
}

function isSchedulingDelay(sample: BlackBoxSample, intervalMs: number): boolean {
  return sample.schedulingDelayMs > Math.max(750, intervalMs * 1.5);
}

function spikeThreshold(baseline: number): number {
  return Math.max(100, baseline * 3, baseline + 100);
}

function incidentSeverity(type: IncidentType, count: number, durationMs: number, peakLatency: number): BlackBoxIncident["severity"] {
  if (type === "reachability-interruption") return durationMs >= 15_000 || count >= 5 ? "critical" : count >= 2 ? "high" : "medium";
  if (type === "browser-suspension") return durationMs >= 30_000 ? "high" : "medium";
  if (type === "latency-spike") return peakLatency >= 500 || durationMs >= 15_000 ? "high" : peakLatency >= 250 ? "medium" : "low";
  if (type === "severe-jitter") return count >= 5 ? "high" : "medium";
  return "medium";
}

function latencyQuality(p95: number): number {
  if (p95 <= 40) return 1;
  if (p95 >= 400) return 0;
  return 1 - (p95 - 40) / 360;
}

function jitterQuality(value: number): number {
  return clamp(1 - value / 50, 0, 1);
}

function qualityLabel(score: number): string {
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Good";
  if (score >= 55) return "Degraded";
  return "Poor";
}

function severityRank(severity: BlackBoxIncident["severity"]): number {
  return severity === "critical" ? 4 : severity === "high" ? 3 : severity === "medium" ? 2 : 1;
}

function percent(value: number, total: number): number {
  return Math.round((value / total) * 10_000) / 100;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function formatClock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${Math.round(durationMs)} ms`;
  return `${Math.max(1, Math.round(durationMs / 1_000))} seconds`;
}
