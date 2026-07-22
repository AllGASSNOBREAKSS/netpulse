/**
 * Versioned endpoint discovery, live probing, and fail-closed selection.
 *
 * The checked-in directory currently advertises one Cloudflare anycast
 * fallback. Requested NetPulse regions remain explicitly planned until real
 * endpoints publish compatible capabilities and pass independent validation.
 */
import {
  FALLBACK_DIRECTORY,
  isHealthFresh,
  loadEndpointDirectory,
  MEASUREMENT_PROTOCOL_VERSION,
  parseEndpointHealth,
  type EndpointDirectoryEntry,
  type EndpointHealth,
} from "./globalNetwork";
import { summarize } from "./stats";
import { linkAbortSignal, throwIfCancelled } from "./cancellation";
import type { ServerProbe, ServerSelection } from "./types";

const PROBE_TIMEOUT_MS = 5_000;
const HEALTH_TIMEOUT_MS = 3_000;
const DEEP_PROBE_CANDIDATES = 4;

export type ServerCandidate = {
  id: string;
  provider: string;
  regionId: string;
  regionLabel: string;
  city: string | null;
  countryCode: string | null;
  status: EndpointDirectoryEntry["status"];
  downPath: (bytes: number) => string;
  upPath: string;
  latencyPath: string;
  tracePath: string | null;
  healthPath: string | null;
  echoPath: string | null;
  protocol: string;
  protocolVersion: number | null;
  throughput: boolean;
};

export type ServerOption = {
  id: string;
  label: string;
  status: "active" | "pilot";
};

let runtimeServers = new Map(FALLBACK_DIRECTORY.endpoints.map((entry) => [entry.id, toCandidate(entry)]));

export async function listServerOptions(): Promise<ServerOption[]> {
  const loaded = await loadEndpointDirectory();
  return loaded.directory.endpoints
    .filter(isSelectableEntry)
    .map((entry) => ({
      id: entry.id,
      label: `${entry.regionLabel} — ${entry.provider}${entry.status === "pilot" ? " (pilot)" : ""}`,
      status: entry.status as "active" | "pilot",
    }));
}

export function getServer(id: string | undefined): ServerCandidate {
  const server = id ? runtimeServers.get(id) : undefined;
  const fallback = runtimeServers.values().next().value as ServerCandidate | undefined;
  if (server) return server;
  if (fallback) return fallback;
  throw new Error("No compatible measurement server has been discovered.");
}

async function timedFetch(url: string, timeoutMs: number, signal?: AbortSignal): Promise<Response | null> {
  const controller = new AbortController();
  const unlink = linkAbortSignal(controller, signal);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    return response.ok ? response : null;
  } catch {
    throwIfCancelled(signal);
    return null;
  } finally {
    clearTimeout(timer);
    unlink();
  }
}

async function pingServer(candidate: ServerCandidate, signal?: AbortSignal): Promise<number | null> {
  const start = performance.now();
  const response = await timedFetch(candidate.latencyPath, PROBE_TIMEOUT_MS, signal);
  return response ? performance.now() - start : null;
}

type TraceInfo = Record<string, string>;

async function fetchTrace(candidate: ServerCandidate, signal?: AbortSignal): Promise<TraceInfo | null> {
  if (!candidate.tracePath) return null;
  const response = await timedFetch(candidate.tracePath, PROBE_TIMEOUT_MS, signal);
  if (!response) return null;
  try {
    const text = await response.text();
    const info: TraceInfo = {};
    for (const line of text.trim().split("\n")) {
      const [key, value] = line.split("=");
      if (key && value) info[key] = value;
    }
    return info;
  } catch {
    return null;
  }
}

async function fetchHealth(candidate: ServerCandidate, signal?: AbortSignal): Promise<EndpointHealth> {
  if (!candidate.healthPath) return unknownHealth("This provider does not publish NetPulse health, load, capacity, or version data.");
  const response = await timedFetch(candidate.healthPath, HEALTH_TIMEOUT_MS, signal);
  if (!response) return unknownHealth("The endpoint health report was unreachable or timed out.");
  try {
    const parsed = parseEndpointHealth(await response.json());
    if (!parsed) return unknownHealth("The endpoint health report failed schema validation.");
    if (!isHealthFresh(parsed)) return unknownHealth("The endpoint health report is stale.");
    return parsed;
  } catch {
    return unknownHealth("The endpoint health report was not valid JSON.");
  }
}

async function probeCandidate(candidate: ServerCandidate, samples: number, signal?: AbortSignal): Promise<ServerProbe> {
  const [trace, health] = await Promise.all([fetchTrace(candidate, signal), fetchHealth(candidate, signal)]);
  await pingServer(candidate, signal); // discarded DNS/TLS/connection warm-up
  const rtts: number[] = [];
  let failed = 0;
  for (let index = 0; index < samples; index++) {
    const rtt = await pingServer(candidate, signal);
    if (rtt === null) failed++;
    else rtts.push(rtt);
  }

  const latency = summarize(rtts);
  const ip = trace?.ip ?? "";
  const ipFamily: ServerProbe["ipFamily"] = ip.includes(":") ? "IPv6" : ip ? "IPv4" : "unknown";
  const versionCompatible =
    (candidate.protocolVersion === null || candidate.protocolVersion === MEASUREMENT_PROTOCOL_VERSION) &&
    (health.protocolVersion === null || health.protocolVersion === MEASUREMENT_PROTOCOL_VERSION);
  const acceptsNewTests = candidate.status !== "draining" && health.status !== "draining" && health.status !== "unavailable";
  const routeConsistency = latency.count > 0 ? 1 / (1 + latency.jitter / Math.max(latency.median, 1)) : 0;

  return {
    id: candidate.id,
    provider: candidate.provider,
    regionId: candidate.regionId,
    regionLabel: candidate.regionLabel,
    edgeCode: trace?.colo ?? null,
    clientCountryCode: trace?.loc ?? null,
    city: candidate.city,
    region: candidate.regionLabel,
    approximateDistanceKm: null,
    protocol: candidate.protocol,
    ipFamily,
    latency,
    available: rtts.length > 0 && versionCompatible && acceptsNewTests,
    attempted: samples,
    failed,
    availability: samples > 0 ? rtts.length / samples : 0,
    rank: 0,
    routeConsistency,
    healthStatus: health.status,
    loadPct: health.loadPct,
    capacityMbps: health.capacityMbps,
    availableCapacityMbps: health.availableCapacityMbps,
    serverVersion: health.serverVersion,
    protocolVersion: health.protocolVersion ?? candidate.protocolVersion,
    healthReason: versionCompatible ? health.reason : `Measurement protocol ${health.protocolVersion ?? candidate.protocolVersion} is incompatible with client protocol ${MEASUREMENT_PROTOCOL_VERSION}.`,
  };
}

/**
 * Ranking weights: median latency 35%, P95 latency 10%, jitter 10%, observed probe consistency 15%,
 * health 15%, current load 10%, capacity headroom 5%, then multiplied by
 * reachability. Unknown operational telemetry is neutral-to-cautious (0.65),
 * never silently treated as healthy.
 */
export function rankProbes(probes: ServerProbe[]): ServerProbe[] {
  const available = probes.filter((probe) => probe.available);
  const bestMedian = Math.min(...available.map((probe) => probe.latency.median), Infinity);
  const bestP95 = Math.min(...available.map((probe) => probe.latency.p95), Infinity);
  return probes
    .map((probe) => {
      if (!probe.available) return { ...probe, rank: 0 };
      const latencyScore = bestMedian / Math.max(probe.latency.median, 1);
      const tailLatencyScore = bestP95 / Math.max(probe.latency.p95, 1);
      const jitterScore = 1 / (1 + probe.latency.jitter / 10);
      const healthScore = probe.healthStatus === "healthy" ? 1 : probe.healthStatus === "degraded" ? 0.5 : 0.65;
      const loadScore = probe.loadPct === null ? 0.65 : Math.max(0.05, 1 - probe.loadPct / 100);
      const capacityScore = probe.availableCapacityMbps === null ? 0.65 : Math.max(0.05, Math.min(1, probe.availableCapacityMbps / 1_000));
      const weighted =
        latencyScore * 0.35 +
        tailLatencyScore * 0.1 +
        jitterScore * 0.1 +
        probe.routeConsistency * 0.15 +
        healthScore * 0.15 +
        loadScore * 0.1 +
        capacityScore * 0.05;
      const rank = weighted * Math.max(0, Math.min(1, probe.availability));
      return { ...probe, rank: Math.round(rank * 100) / 100 };
    })
    .sort((left, right) => right.rank - left.rank);
}

export async function selectServer(
  probesPerServer: number,
  manualId: string | undefined,
  options: { signal?: AbortSignal; onStage?: (stage: "discovering" | "probing" | "selecting") => void; onProbe?: (probe: ServerProbe) => void } = {},
): Promise<ServerSelection> {
  throwIfCancelled(options.signal);
  options.onStage?.("discovering");
  const loaded = await loadEndpointDirectory();
  throwIfCancelled(options.signal);
  const entries = loaded.directory.endpoints.filter((entry) => entry.status !== "disabled");
  const candidates = entries.map(toCandidate);
  runtimeServers = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  if (candidates.length === 0) throw new Error("The endpoint directory contains no compatible measurement servers.");

  options.onStage?.("probing");
  let probes: ServerProbe[];
  if (candidates.length <= DEEP_PROBE_CANDIDATES) {
    probes = rankProbes(await Promise.all(candidates.map((candidate) => probeCandidate(candidate, Math.max(2, probesPerServer), options.signal))));
  } else {
    const shallow = rankProbes(await Promise.all(candidates.map((candidate) => probeCandidate(candidate, 1, options.signal))));
    const shortlistIds = new Set(
      shallow
        .filter((probe) => probe.available)
        .slice(0, DEEP_PROBE_CANDIDATES)
        .map((probe) => probe.id),
    );
    if (manualId && runtimeServers.has(manualId)) shortlistIds.add(manualId);
    const deep = await Promise.all(
      candidates
        .filter((candidate) => shortlistIds.has(candidate.id))
        .map((candidate) => probeCandidate(candidate, Math.max(2, probesPerServer), options.signal)),
    );
    const deepById = new Map(deep.map((probe) => [probe.id, probe]));
    probes = rankProbes(shallow.map((probe) => deepById.get(probe.id) ?? probe));
  }
  probes.forEach((probe) => options.onProbe?.(probe));
  options.onStage?.("selecting");
  const reachable = probes.filter((probe) => probe.available);
  if (reachable.length === 0) throw new Error("No compatible measurement endpoint passed reachability and health checks.");

  const requested = manualId ? reachable.find((probe) => probe.id === manualId) : undefined;
  const chosen = requested ?? reachable[0];
  const manual = Boolean(requested);
  const backups = reachable.filter((probe) => probe.id !== chosen.id).slice(0, 2);
  const loadText = chosen.loadPct === null ? "load unavailable" : `${Math.round(chosen.loadPct)}% reported load`;
  const capacityText = chosen.availableCapacityMbps === null ? "capacity unavailable" : `${Math.round(chosen.availableCapacityMbps)} Mbps reported headroom`;
  const selectionBasis = `${Math.round(chosen.latency.median)} ms median HTTPS latency, ${Math.round(chosen.latency.jitter)} ms jitter, ${Math.round(chosen.availability * 100)}% probe reachability, ${loadText}, ${capacityText}`;
  const reason = manual
    ? `Manually selected ${chosen.regionLabel} (${chosen.provider}); observed ${selectionBasis}.`
    : reachable.length === 1
      ? `${chosen.regionLabel} (${chosen.provider}) is the only reachable compatible endpoint; observed ${selectionBasis}.`
      : `Selected ${chosen.regionLabel} (${chosen.provider}) from ${reachable.length} reachable endpoints using latency, jitter, probe consistency, health, load, capacity, and reachability; observed ${selectionBasis}.`;
  const degraded =
    reachable.length < 2 ||
    chosen.healthStatus !== "healthy" ||
    chosen.loadPct === null ||
    chosen.availableCapacityMbps === null;

  return {
    chosen,
    candidates: probes,
    backups,
    reason,
    manual,
    degraded,
    directoryRevision: loaded.directory.revision,
    directorySource: loaded.source,
    directoryWarning: loaded.warning,
    coverage: loaded.directory.coverage,
  };
}

function isSelectableEntry(entry: EndpointDirectoryEntry): boolean {
  return (entry.status === "active" || entry.status === "pilot") && entry.capabilities.download && entry.capabilities.upload && entry.capabilities.latency;
}

function toCandidate(entry: EndpointDirectoryEntry): ServerCandidate {
  return {
    id: entry.id,
    provider: entry.provider,
    regionId: entry.regionId,
    regionLabel: entry.regionLabel,
    city: entry.city,
    countryCode: entry.countryCode,
    status: entry.status,
    downPath: (bytes) => entry.downloadUrlTemplate.replace("{bytes}", String(Math.max(0, Math.floor(bytes)))),
    upPath: entry.uploadUrl,
    latencyPath: entry.latencyUrl,
    tracePath: entry.traceUrl,
    healthPath: entry.healthUrl,
    echoPath: entry.echoUrl,
    protocol: entry.protocol,
    protocolVersion: entry.protocolVersion,
    throughput: entry.capabilities.download && entry.capabilities.upload,
  };
}

function unknownHealth(reason: string): EndpointHealth {
  return {
    status: "unknown",
    checkedAt: null,
    expiresAt: null,
    loadPct: null,
    capacityMbps: null,
    availableCapacityMbps: null,
    activeTests: null,
    maxConcurrentTests: null,
    serverVersion: null,
    protocolVersion: null,
    reason,
  };
}
