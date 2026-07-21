import {
  BLACK_BOX_SCHEMA_VERSION,
  type BlackBoxSession,
  type DnsObservation,
  type EndpointObservation,
  type LagMarker,
  type MonitorMode,
  type VisibilityEvent,
  type BlackBoxSample,
} from "./blackbox";

const SESSIONS_KEY = "netpulse_blackbox_sessions_v1";
const RETENTION_KEY = "netpulse_blackbox_retention_days";
const MAX_SESSIONS = 10;
const MAX_SAMPLES = 5_000;
const MAX_SUPPORTING_OBSERVATIONS = 600;
const MAX_MARKERS = 100;
const VALID_RETENTION_DAYS = [1, 7, 30, 90] as const;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type StorageResult<T> = { ok: true; value: T } | { ok: false; value: T; error: string };

export function loadBlackBoxSessions(
  storage: StorageLike | null = browserStorage(),
  now = Date.now(),
  retentionDays = loadRetentionDays(storage),
): StorageResult<BlackBoxSession[]> {
  if (!storage) return { ok: false, value: [], error: "Browser storage is unavailable." };
  try {
    const parsed: unknown = JSON.parse(storage.getItem(SESSIONS_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return { ok: false, value: [], error: "Saved monitoring data had an invalid format and was ignored." };
    const cutoff = now - retentionDays * 86_400_000;
    const sessions = parsed
      .filter(isBlackBoxSession)
      .filter((session) => (session.endedAt ?? session.startedAt) >= cutoff)
      .map((session) => recoverInterruptedSession(session, now))
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, MAX_SESSIONS);
    return { ok: true, value: sessions };
  } catch (error) {
    return { ok: false, value: [], error: storageError("read", error) };
  }
}

export function saveBlackBoxSession(
  session: BlackBoxSession,
  storage: StorageLike | null = browserStorage(),
  now = Date.now(),
  retentionDays = loadRetentionDays(storage),
): StorageResult<BlackBoxSession[]> {
  if (!storage) return { ok: false, value: [trimSession(session)], error: "Browser storage is unavailable." };
  const loaded = loadBlackBoxSessions(storage, now, retentionDays);
  const trimmed = trimSession(session);
  const next = [trimmed, ...loaded.value.filter((item) => item.id !== session.id)]
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, MAX_SESSIONS);
  try {
    storage.setItem(SESSIONS_KEY, JSON.stringify(next));
    return { ok: true, value: next };
  } catch (error) {
    return { ok: false, value: next, error: storageError("save", error) };
  }
}

export function deleteBlackBoxSession(
  id: string,
  storage: StorageLike | null = browserStorage(),
  now = Date.now(),
  retentionDays = loadRetentionDays(storage),
): StorageResult<BlackBoxSession[]> {
  if (!storage) return { ok: false, value: [], error: "Browser storage is unavailable." };
  const loaded = loadBlackBoxSessions(storage, now, retentionDays);
  const next = loaded.value.filter((session) => session.id !== id);
  try {
    storage.setItem(SESSIONS_KEY, JSON.stringify(next));
    return { ok: true, value: next };
  } catch (error) {
    return { ok: false, value: next, error: storageError("delete", error) };
  }
}

export function clearBlackBoxSessions(storage: StorageLike | null = browserStorage()): StorageResult<[]> {
  if (!storage) return { ok: false, value: [], error: "Browser storage is unavailable." };
  try {
    storage.removeItem(SESSIONS_KEY);
    return { ok: true, value: [] };
  } catch (error) {
    return { ok: false, value: [], error: storageError("clear", error) };
  }
}

export function loadRetentionDays(storage: StorageLike | null = browserStorage()): number {
  if (!storage) return 30;
  try {
    const parsed = Number(storage.getItem(RETENTION_KEY));
    return isRetentionDays(parsed) ? parsed : 30;
  } catch {
    return 30;
  }
}

export function saveRetentionDays(days: number, storage: StorageLike | null = browserStorage()): StorageResult<number> {
  const safeDays = isRetentionDays(days) ? days : 30;
  if (!storage) return { ok: false, value: safeDays, error: "Browser storage is unavailable." };
  try {
    storage.setItem(RETENTION_KEY, String(safeDays));
    return { ok: true, value: safeDays };
  } catch (error) {
    return { ok: false, value: safeDays, error: storageError("save retention settings", error) };
  }
}

function trimSession(session: BlackBoxSession): BlackBoxSession {
  return {
    ...session,
    samples: session.samples.slice(-MAX_SAMPLES),
    dns: session.dns.slice(-MAX_SUPPORTING_OBSERVATIONS),
    endpoints: session.endpoints.slice(-MAX_SUPPORTING_OBSERVATIONS),
    visibility: session.visibility.slice(-MAX_SUPPORTING_OBSERVATIONS),
    lagMarkers: session.lagMarkers.slice(-MAX_MARKERS),
  };
}

function recoverInterruptedSession(session: BlackBoxSession, now: number): BlackBoxSession {
  if (session.status !== "running" && session.status !== "paused") return session;
  const lastObserved = Math.max(
    session.startedAt,
    session.samples.at(-1)?.completedAt ?? 0,
    session.dns.at(-1)?.measuredAt ?? 0,
    session.endpoints.at(-1)?.measuredAt ?? 0,
  );
  return {
    ...session,
    status: "interrupted",
    endedAt: Math.min(now, lastObserved),
    pauseStartedAt: null,
    storageWarning: "The browser was refreshed or closed before this session stopped. Samples recorded before the interruption were preserved.",
  };
}

function isBlackBoxSession(value: unknown): value is BlackBoxSession {
  if (!isRecord(value)) return false;
  return value.schemaVersion === BLACK_BOX_SCHEMA_VERSION &&
    typeof value.id === "string" &&
    isMonitorMode(value.mode) &&
    isFiniteNumber(value.createdAt) &&
    isFiniteNumber(value.startedAt) &&
    isNullableNumber(value.endedAt) &&
    includes(["running", "paused", "completed", "stopped", "interrupted"] as const, value.status) &&
    isFiniteNumber(value.pausedDurationMs) &&
    isNullableNumber(value.pauseStartedAt) &&
    Array.isArray(value.samples) && value.samples.every(isSample) &&
    Array.isArray(value.dns) && value.dns.every(isDns) &&
    Array.isArray(value.endpoints) && value.endpoints.every(isEndpointObservation) &&
    Array.isArray(value.visibility) && value.visibility.every(isVisibilityEvent) &&
    Array.isArray(value.lagMarkers) && value.lagMarkers.every(isLagMarker) &&
    isFiniteNumber(value.dataReceivedBytes) &&
    (value.identity === null || isIdentity(value.identity)) &&
    typeof value.secondaryEndpointConfigured === "boolean" &&
    (value.storageWarning === null || typeof value.storageWarning === "string");
}

function isMonitorMode(value: unknown): value is MonitorMode {
  if (!isRecord(value)) return false;
  return includes(["quick", "gaming", "video-call", "work", "evening", "custom"] as const, value.id) &&
    typeof value.label === "string" &&
    typeof value.description === "string" &&
    isPositive(value.durationMs) &&
    isPositive(value.probeIntervalMs) &&
    isPositive(value.dnsIntervalMs) &&
    isPositive(value.traceIntervalMs) &&
    isFiniteNumber(value.estimatedPayloadBytes);
}

function isSample(value: unknown): value is BlackBoxSample {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" &&
    isFiniteNumber(value.scheduledAt) &&
    isFiniteNumber(value.startedAt) &&
    isFiniteNumber(value.completedAt) &&
    isFiniteNumber(value.schedulingDelayMs) &&
    includes(["visible", "hidden", "prerender", "unknown"] as const, value.visibility) &&
    isEndpointResult(value.primary) &&
    isEndpointResult(value.secondary);
}

function isDns(value: unknown): value is DnsObservation {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" && isFiniteNumber(value.measuredAt) &&
    includes(["ok", "failed"] as const, value.status) && isNullableNumber(value.durationMs) &&
    isNullableNumber(value.responseCode) && isFiniteNumber(value.bytesReceived) &&
    value.provider === "Cloudflare DNS over HTTPS" && typeof value.detail === "string";
}

function isEndpointObservation(value: unknown): value is EndpointObservation {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" && isFiniteNumber(value.measuredAt) &&
    (value.edgeCode === null || typeof value.edgeCode === "string") &&
    includes(["IPv4", "IPv6", "unknown"] as const, value.observedIpFamily) &&
    isEndpointResult(value.ipv4) && isEndpointResult(value.ipv6) && isFiniteNumber(value.bytesReceived);
}

function isVisibilityEvent(value: unknown): value is VisibilityEvent {
  return isRecord(value) && typeof value.id === "string" && isFiniteNumber(value.at) && includes(["visible", "hidden", "prerender", "unknown"] as const, value.state);
}

function isLagMarker(value: unknown): value is LagMarker {
  return isRecord(value) && typeof value.id === "string" && isFiniteNumber(value.at) && (value.note === null || typeof value.note === "string");
}

function isIdentity(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return nullableString(value.isp) && nullableString(value.asn) && nullableString(value.approximateRegion) && value.source === "ipwho.is";
}

function isEndpointResult(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return includes(["ok", "failed", "unavailable"] as const, value.status) &&
    isNullableNumber(value.durationMs) && isFiniteNumber(value.bytesReceived) && typeof value.detail === "string";
}

function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function storageError(action: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : "unknown storage error";
  return `Could not ${action} monitoring sessions: ${detail}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositive(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

function nullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function includes<const T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function isRetentionDays(value: number): value is (typeof VALID_RETENTION_DAYS)[number] {
  return VALID_RETENTION_DAYS.includes(value as (typeof VALID_RETENTION_DAYS)[number]);
}
