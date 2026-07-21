export type HistoryEntry = {
  ts: number;
  down: number;
  up: number;
  ping: number;
  bloat: number;
  grade: string;
  score: number;
  dataMB: number;
  confidence?: number;
  loadedDownMs?: number;
  loadedUpMs?: number;
  jitterMs?: number;
  stabilityScore?: number;
  durationMs?: number;
  connectionMedium?: "wifi" | "ethernet" | "mobile" | "other" | "unknown";
  timezoneOffsetMinutes?: number;
};

const HISTORY_KEY = "netpulse_history";
const MAX_HISTORY = 50;

export function loadHistory(): HistoryEntry[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isHistoryEntry).slice(0, MAX_HISTORY) : [];
  } catch (error) {
    console.warn("NetPulse could not read local test history.", error);
    return [];
  }
}

export function saveHistory(entries: HistoryEntry[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY)));
  } catch (error) {
    console.warn("NetPulse could not save local test history.", error);
  }
}

function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.ts === "number" &&
    typeof entry.down === "number" &&
    typeof entry.up === "number" &&
    typeof entry.ping === "number" &&
    typeof entry.bloat === "number" &&
    typeof entry.grade === "string" &&
    typeof entry.score === "number" &&
    typeof entry.dataMB === "number" &&
    optionalNumber(entry.confidence) &&
    optionalNumber(entry.loadedDownMs) &&
    optionalNumber(entry.loadedUpMs) &&
    optionalNumber(entry.jitterMs) &&
    optionalNumber(entry.stabilityScore) &&
    optionalNumber(entry.durationMs) &&
    optionalNumber(entry.timezoneOffsetMinutes) &&
    (entry.connectionMedium === undefined || ["wifi", "ethernet", "mobile", "other", "unknown"].includes(String(entry.connectionMedium)))
  );
}

function optionalNumber(value: unknown): boolean {
  return value === undefined || typeof value === "number" && Number.isFinite(value);
}
