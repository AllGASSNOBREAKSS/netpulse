import {
  DIAGNOSTIC_SCHEMA_VERSION,
  type DiagnosticConditions,
  type DiagnosticMeasurement,
  type DiagnosticRun,
  type DiagnosticRunKind,
  type DiagnosticSession,
  type DiagnosticSymptom,
} from "./diagnostics";

const STORAGE_KEY = "netpulse_diagnostic_sessions_v1";
const MAX_SESSIONS = 12;
const MAX_RUNS = 20;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function loadDiagnosticSessions(storage: StorageLike | null = browserStorage()): DiagnosticSession[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isDiagnosticSession).map(trimSession).slice(0, MAX_SESSIONS);
  } catch (error) {
    console.warn("NetPulse could not read local diagnostic sessions.", error);
    return [];
  }
}

export function saveDiagnosticSession(
  session: DiagnosticSession,
  storage: StorageLike | null = browserStorage(),
): DiagnosticSession[] {
  if (!storage) return [trimSession(session)];
  const updated = { ...trimSession(session), updatedAt: Date.now() };
  const sessions = loadDiagnosticSessions(storage).filter((item) => item.id !== session.id);
  const next = [updated, ...sessions].slice(0, MAX_SESSIONS);
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (error) {
    console.warn("NetPulse could not save the local diagnostic session.", error);
  }
  return next;
}

export function deleteDiagnosticSession(id: string, storage: StorageLike | null = browserStorage()): DiagnosticSession[] {
  if (!storage) return [];
  const next = loadDiagnosticSessions(storage).filter((session) => session.id !== id);
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (error) {
    console.warn("NetPulse could not delete the local diagnostic session.", error);
  }
  return next;
}

export function clearDiagnosticSessions(storage: StorageLike | null = browserStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn("NetPulse could not clear local diagnostic sessions.", error);
  }
}

function trimSession(session: DiagnosticSession): DiagnosticSession {
  return { ...session, runs: session.runs.slice(-MAX_RUNS) };
}

function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function isDiagnosticSession(value: unknown): value is DiagnosticSession {
  if (!isRecord(value)) return false;
  return (
    value.schemaVersion === DIAGNOSTIC_SCHEMA_VERSION &&
    typeof value.id === "string" &&
    isFiniteNumber(value.createdAt) &&
    isFiniteNumber(value.updatedAt) &&
    isSymptom(value.symptom) &&
    isNullablePositiveNumber(value.planDownloadMbps) &&
    isNullablePositiveNumber(value.planUploadMbps) &&
    Array.isArray(value.runs) &&
    value.runs.every(isDiagnosticRun)
  );
}

function isDiagnosticRun(value: unknown): value is DiagnosticRun {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    isRunKind(value.kind) &&
    typeof value.label === "string" &&
    isFiniteNumber(value.measuredAt) &&
    isConditions(value.conditions) &&
    isMeasurement(value.measurement)
  );
}

function isConditions(value: unknown): value is DiagnosticConditions {
  if (!isRecord(value)) return false;
  return (
    includes(["wifi", "ethernet", "unknown"], value.link) &&
    includes(["usual", "near-router", "unknown"], value.location) &&
    includes(["on", "off", "unknown"], value.vpn) &&
    includes(["normal", "paused", "unknown"], value.backgroundTraffic) &&
    includes(["primary", "other"], value.device) &&
    includes(["usual", "peak", "off-peak"], value.time) &&
    includes(["none", "router", "modem"], value.afterRestart) &&
    includes(["auto", "ipv4", "ipv6"], value.requestedIpFamily)
  );
}

function isMeasurement(value: unknown): value is DiagnosticMeasurement {
  if (!isRecord(value)) return false;
  const numeric = [
    value.downloadMbps,
    value.uploadMbps,
    value.idleLatencyMs,
    value.jitterMs,
    value.loadedDownMs,
    value.loadedUpMs,
    value.bufferbloatDownMs,
    value.bufferbloatUpMs,
    value.stabilityScore,
    value.confidenceScore,
    value.durationMs,
    value.dataUsedMB,
    value.idleSamples,
    value.loadedDownSamples,
    value.loadedUpSamples,
  ];
  return (
    numeric.every(isFiniteNumber) &&
    typeof value.endpointProvider === "string" &&
    (value.endpointEdge === null || typeof value.endpointEdge === "string") &&
    typeof value.endpointProtocol === "string" &&
    includes(["IPv4", "IPv6", "unknown"], value.observedIpFamily) &&
    typeof value.lowData === "boolean" &&
    value.packetLossStatus === "unavailable" &&
    Array.isArray(value.limitations) &&
    value.limitations.every((item) => typeof item === "string")
  );
}

function isSymptom(value: unknown): value is DiagnosticSymptom {
  return includes(
    ["buffering-video", "video-calls", "gaming", "slow-downloads", "slow-uploads", "slow-websites", "intermittent", "offline", "other"],
    value,
  );
}

function isRunKind(value: unknown): value is DiagnosticRunKind {
  return includes(
    ["baseline", "near-router", "original-room", "ethernet", "vpn-off", "background-paused", "other-device", "router-restarted", "modem-restarted", "peak-time", "off-peak", "ipv4", "ipv6"],
    value,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNullablePositiveNumber(value: unknown): value is number | null {
  return value === null || (isFiniteNumber(value) && value > 0);
}

function includes<const T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && values.includes(value as T);
}
