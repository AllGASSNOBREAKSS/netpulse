import { median } from "./stats";
import type { HistoryEntry } from "./history";

export type ConnectionMedium = "wifi" | "ethernet" | "mobile" | "other" | "unknown";

export type PlanProfile = {
  isp: string;
  planName: string;
  advertisedDownloadMbps: number;
  advertisedUploadMbps: number | null;
  monthlyPrice: number | null;
  dataAllowanceGb: number | null;
  connectionType: string;
};

export type PlanRealityResult = {
  validTests: HistoryEntry[];
  excludedLowConfidence: number;
  excludedInvalid: number;
  medianDownloadMbps: number;
  medianUploadMbps: number;
  deliveredDownloadPct: number;
  deliveredUploadPct: number | null;
  peakHourMedianMbps: number | null;
  offPeakMedianMbps: number | null;
  wiredMedianMbps: number | null;
  wifiMedianMbps: number | null;
  wifiVsWiredDifferencePct: number | null;
  loadedDownRiseMs: number | null;
  loadedUpRiseMs: number | null;
  reliabilityScore: number;
  reliabilityFormula: string;
};

export const PLAN_HISTORY_MIN_CONFIDENCE = 65;
const PROFILE_KEY = "netpulse_plan_profile_v1";

export function evaluatePlanReality(profile: PlanProfile, history: HistoryEntry[]): PlanRealityResult {
  const excludedLowConfidence = history.filter((entry) => (entry.confidence ?? 0) < PLAN_HISTORY_MIN_CONFIDENCE).length;
  const validTests = history.filter((entry) => isValidHistoryForPlan(entry));
  const excludedInvalid = history.length - validTests.length - excludedLowConfidence;
  const down = validTests.map((entry) => entry.down);
  const up = validTests.map((entry) => entry.up);
  const medianDownloadMbps = median(down);
  const medianUploadMbps = median(up);
  const peak = validTests.filter(isPeakHour).map((entry) => entry.down);
  const offPeak = validTests.filter((entry) => !isPeakHour(entry)).map((entry) => entry.down);
  const wired = validTests.filter((entry) => entry.connectionMedium === "ethernet").map((entry) => entry.down);
  const wifi = validTests.filter((entry) => entry.connectionMedium === "wifi").map((entry) => entry.down);
  const wiredMedianMbps = wired.length >= 2 ? median(wired) : null;
  const wifiMedianMbps = wifi.length >= 2 ? median(wifi) : null;
  const stabilityValues = validTests.map((entry) => entry.stabilityScore).filter((value): value is number => typeof value === "number");
  const loadedValues = validTests.map((entry) => maxLoadedRise(entry)).filter((value): value is number => value !== null);
  const consistency = consistencyScore(down);
  const stability = stabilityValues.length ? median(stabilityValues) : 50;
  const loadedQuality = loadedValues.length ? loadedLatencyQuality(median(loadedValues)) : 50;
  const reliabilityScore = Math.round(consistency * 0.5 + stability * 0.25 + loadedQuality * 0.25);

  return {
    validTests,
    excludedLowConfidence,
    excludedInvalid,
    medianDownloadMbps,
    medianUploadMbps,
    deliveredDownloadPct: percentOf(medianDownloadMbps, profile.advertisedDownloadMbps),
    deliveredUploadPct: profile.advertisedUploadMbps ? percentOf(medianUploadMbps, profile.advertisedUploadMbps) : null,
    peakHourMedianMbps: peak.length >= 2 ? median(peak) : null,
    offPeakMedianMbps: offPeak.length >= 2 ? median(offPeak) : null,
    wiredMedianMbps,
    wifiMedianMbps,
    wifiVsWiredDifferencePct: wiredMedianMbps !== null && wifiMedianMbps !== null && wiredMedianMbps > 0 ? ((wiredMedianMbps - wifiMedianMbps) / wiredMedianMbps) * 100 : null,
    loadedDownRiseMs: medianOptional(validTests.map((entry) => entry.loadedDownMs !== undefined ? Math.max(0, entry.loadedDownMs - entry.ping) : null)),
    loadedUpRiseMs: medianOptional(validTests.map((entry) => entry.loadedUpMs !== undefined ? Math.max(0, entry.loadedUpMs - entry.ping) : null)),
    reliabilityScore: Math.max(0, Math.min(100, reliabilityScore)),
    reliabilityFormula: "50% download consistency (median absolute deviation), 25% median run stability, and 25% median worst loaded-latency quality. This is not uptime or contractual compliance.",
  };
}

export function savePlanProfile(profile: PlanProfile, storage: Storage = localStorage): void {
  storage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export function loadPlanProfile(storage: Storage = localStorage): PlanProfile | null {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(PROFILE_KEY) ?? "null");
    return isPlanProfile(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function createPlanRealityReport(profile: PlanProfile, result: PlanRealityResult): string {
  const lines = [
    "NetPulse ISP Plan Reality Check",
    `Generated: ${new Date().toISOString()}`,
    `ISP: ${profile.isp}`,
    `Plan: ${profile.planName}`,
    `Listed rates: ${profile.advertisedDownloadMbps} Mbps down / ${profile.advertisedUploadMbps ?? "unavailable"} Mbps up`,
    `Connection type: ${profile.connectionType || "unavailable"}`,
    `Monthly price: ${profile.monthlyPrice ?? "not provided"}`,
    `Data allowance: ${profile.dataAllowanceGb ?? "not provided"} GB`,
    "",
    `Valid tests: ${result.validTests.length}`,
    `Excluded low-confidence tests: ${result.excludedLowConfidence}`,
    `Excluded invalid tests: ${result.excludedInvalid}`,
    `Median download: ${format(result.medianDownloadMbps)} Mbps (${format(result.deliveredDownloadPct)}% of listed rate)`,
    `Median upload: ${format(result.medianUploadMbps)} Mbps${result.deliveredUploadPct === null ? "" : ` (${format(result.deliveredUploadPct)}% of listed rate)`}`,
    `Peak-hour median: ${formatOptional(result.peakHourMedianMbps, "Mbps")}`,
    `Off-peak median: ${formatOptional(result.offPeakMedianMbps, "Mbps")}`,
    `Ethernet median: ${formatOptional(result.wiredMedianMbps, "Mbps")}`,
    `Wi-Fi median: ${formatOptional(result.wifiMedianMbps, "Mbps")}`,
    `Median download-loaded rise: ${formatOptional(result.loadedDownRiseMs, "ms")}`,
    `Median upload-loaded rise: ${formatOptional(result.loadedUpRiseMs, "ms")}`,
    `Reliability indicator: ${result.reliabilityScore}/100`,
    result.reliabilityFormula,
    "Outages: not included. Test history does not establish outage duration; use a separate Connection Black Box support report for measured long-run interruptions.",
    "",
    "Measurement dates and conditions",
    ...result.validTests.map((entry) => `- ${new Date(entry.ts).toISOString()} | ${format(entry.down)} down | ${format(entry.up)} up | ${entry.connectionMedium ?? "unknown"} | confidence ${entry.confidence ?? 0}%`),
    "",
    "Limitations",
    "- Results reflect only locally saved browser tests on this device.",
    "- Wi-Fi/Ethernet labels are user supplied because browsers cannot reliably detect the access medium.",
    "- Peak hours are 6:00 PM through 10:59 PM in the timezone recorded at test time.",
    "- This report does not determine contract compliance, fraud, compensation, or legal responsibility.",
  ];
  return lines.join("\r\n");
}

export function isPlanProfile(value: unknown): value is PlanProfile {
  if (!isRecord(value)) return false;
  return boundedText(value.isp, 2, 80) && boundedText(value.planName, 1, 80) && bounded(value.advertisedDownloadMbps, 0, 100_000) && (value.advertisedUploadMbps === null || bounded(value.advertisedUploadMbps, 0, 100_000)) && (value.monthlyPrice === null || bounded(value.monthlyPrice, -1, 1_000_000)) && (value.dataAllowanceGb === null || bounded(value.dataAllowanceGb, 0, 1_000_000_000)) && boundedText(value.connectionType, 1, 80);
}

function isValidHistoryForPlan(entry: HistoryEntry): boolean {
  return (entry.confidence ?? 0) >= PLAN_HISTORY_MIN_CONFIDENCE && finitePositive(entry.down) && finitePositive(entry.up) && finitePositive(entry.ping);
}

function isPeakHour(entry: HistoryEntry): boolean {
  const offset = entry.timezoneOffsetMinutes ?? new Date(entry.ts).getTimezoneOffset();
  const local = new Date(entry.ts - offset * 60_000);
  const hour = local.getUTCHours();
  return hour >= 18 && hour < 23;
}

function consistencyScore(values: number[]): number {
  if (values.length < 2) return values.length === 1 ? 50 : 0;
  const center = median(values);
  if (center <= 0) return 0;
  const mad = median(values.map((value) => Math.abs(value - center)));
  return Math.max(0, Math.min(100, (1 - mad / center) * 100));
}

function loadedLatencyQuality(riseMs: number): number {
  if (riseMs <= 20) return 100;
  if (riseMs >= 300) return 0;
  return 100 * (1 - (riseMs - 20) / 280);
}

function maxLoadedRise(entry: HistoryEntry): number | null {
  const values = [entry.loadedDownMs, entry.loadedUpMs].filter((value): value is number => typeof value === "number");
  return values.length ? Math.max(...values.map((value) => Math.max(0, value - entry.ping))) : null;
}

function medianOptional(values: Array<number | null>): number | null {
  const available = values.filter((value): value is number => value !== null);
  return available.length ? median(available) : null;
}

function percentOf(value: number, listed: number): number {
  return listed > 0 ? (value / listed) * 100 : 0;
}

function format(value: number): string {
  return value >= 100 ? String(Math.round(value)) : value.toFixed(1);
}

function formatOptional(value: number | null, unit: string): string {
  return value === null ? "insufficient data" : `${format(value)} ${unit}`;
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function bounded(value: unknown, exclusiveMin: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > exclusiveMin && value <= max;
}

function boundedText(value: unknown, min: number, max: number): value is string {
  return typeof value === "string" && value.trim().length >= min && value.trim().length <= max;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
