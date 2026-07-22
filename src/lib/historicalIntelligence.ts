import { median } from "./stats";
import type { HistoryEntry } from "./history";

export type HistoricalMetric = "down" | "up" | "ping" | "jitterMs" | "loadedDownMs" | "loadedUpMs" | "stabilityScore";

export type BaselineAssessment = {
  metric: HistoricalMetric;
  sampleCount: number;
  baselineMedian: number | null;
  medianAbsoluteDeviation: number | null;
  currentValue: number | null;
  deviationPct: number | null;
  degraded: boolean;
  confirmed: boolean;
  confirmationRule: string;
};

export type IspHistoryComparison = {
  isp: string;
  sampleCount: number;
  medianDownloadMbps: number;
  medianUploadMbps: number;
  medianLatencyMs: number;
  medianLoadedLatencyMs: number | null;
  medianConfidence: number | null;
};

/** Compare only locally recorded, named ISP groups with enough completed runs. */
export function compareIspHistory(history: HistoryEntry[], minimumSamples = 3): IspHistoryComparison[] {
  const groups = new Map<string, HistoryEntry[]>();
  for (const entry of history) {
    const isp = entry.isp?.trim();
    if (!isp) continue;
    const existing = groups.get(isp) ?? [];
    existing.push(entry);
    groups.set(isp, existing);
  }
  return [...groups.entries()]
    .filter(([, entries]) => entries.length >= minimumSamples)
    .map(([isp, entries]) => {
      const loaded = entries.flatMap((entry) => {
        const values = [entry.loadedDownMs, entry.loadedUpMs].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
        return values.length ? [Math.max(...values)] : [];
      });
      const confidence = entries.map((entry) => entry.confidence).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
      return {
        isp,
        sampleCount: entries.length,
        medianDownloadMbps: median(entries.map((entry) => entry.down)),
        medianUploadMbps: median(entries.map((entry) => entry.up)),
        medianLatencyMs: median(entries.map((entry) => entry.ping)),
        medianLoadedLatencyMs: loaded.length ? median(loaded) : null,
        medianConfidence: confidence.length ? median(confidence) : null,
      };
    })
    .sort((left, right) => right.sampleCount - left.sampleCount || left.isp.localeCompare(right.isp));
}

export function assessHistoricalMetric(
  history: HistoryEntry[],
  metric: HistoricalMetric,
  currentValue: number | null,
  options: { minimumSamples?: number; degradationPct?: number; required?: number; window?: number; higherIsWorse?: boolean } = {},
): BaselineAssessment {
  const minimumSamples = options.minimumSamples ?? 7;
  const degradationPct = options.degradationPct ?? 25;
  const required = options.required ?? 3;
  const window = options.window ?? 5;
  const higherIsWorse = options.higherIsWorse ?? ["ping", "jitterMs", "loadedDownMs", "loadedUpMs"].includes(metric);
  const values = history.map((entry) => entry[metric]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const baselineValues = values.slice(0, Math.max(minimumSamples, 30));
  const baselineMedian = baselineValues.length >= minimumSamples ? median(baselineValues) : null;
  const mad = baselineMedian === null ? null : median(baselineValues.map((value) => Math.abs(value - baselineMedian)));
  const deviationPct = currentValue === null || baselineMedian === null || baselineMedian === 0
    ? null
    : ((currentValue - baselineMedian) / baselineMedian) * 100;
  const degraded = deviationPct !== null && (higherIsWorse ? deviationPct >= degradationPct : deviationPct <= -degradationPct);

  const recent = currentValue === null ? values.slice(0, window) : [currentValue, ...values].slice(0, window);
  const degradedRecent = baselineMedian === null ? 0 : recent.filter((value) => {
    const deviation = ((value - baselineMedian) / Math.max(Math.abs(baselineMedian), Number.EPSILON)) * 100;
    return higherIsWorse ? deviation >= degradationPct : deviation <= -degradationPct;
  }).length;

  return {
    metric,
    sampleCount: baselineValues.length,
    baselineMedian,
    medianAbsoluteDeviation: mad,
    currentValue,
    deviationPct,
    degraded,
    confirmed: degraded && degradedRecent >= required,
    confirmationRule: `${required} of the latest ${window} tests must be at least ${degradationPct}% ${higherIsWorse ? "above" : "below"} the personal median.`,
  };
}
