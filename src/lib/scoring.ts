/**
 * NetPulse health-score configuration.
 *
 * This file is the SINGLE source of truth for how the 0–100 score is
 * computed. Each scored rule turns one measured or derived input into a 0–1
 * quality factor and multiplies it by its weight; scored weights sum to 100.
 * Packet loss is disclosed as a zero-weight, unscored row until valid
 * infrastructure exists. Nothing else feeds the
 * score, and the in-app "score breakdown" panel renders exactly this
 * structure — what users see is what runs.
 *
 * Tuning rationale:
 * - Throughput uses a log curve: doubling a slow link matters far more than
 *   doubling a fast one. `full` marks diminishing returns — the point where
 *   the full weight is earned.
 * - Responsiveness (idle latency, loaded latency/bufferbloat, jitter,
 *   stability) carries 48/100 points. Run confidence carries 12/100 so weak
 *   sampling cannot produce an apparently definitive health score.
 */
import type { TestResult } from "./engine";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const publishedDownload = (r: TestResult) => r.publication?.download.valueMbps ?? (r.publication ? null : r.downloadMbps);
const publishedUpload = (r: TestResult) => r.publication?.upload.valueMbps ?? (r.publication ? null : r.uploadMbps);

/** Log-ish curve: 1.0 at `full`, ~0.5 around full/5, 0 at 0. */
function curve(value: number, full: number): number {
  if (value <= 0) return 0;
  return clamp(Math.log(1 + value) / Math.log(1 + full), 0, 1);
}

export type ScoreRule = {
  id: string;
  label: string;
  /** Points this component is worth. All weights sum to 100. */
  weight: number;
  /** False means the row is disclosed but excluded because no valid measurement exists. */
  scored?: boolean;
  /** Human-readable statement of the rule, shown in the breakdown panel. */
  rule: string;
  /** The measured input, formatted for display. */
  input: (r: TestResult) => string;
  /** False omits unavailable evidence instead of scoring it as zero. */
  applicable?: (r: TestResult) => boolean;
  /** 0–1 quality factor computed from measured data only. */
  quality: (r: TestResult) => number;
};

const BLOAT_QUALITY: Record<TestResult["bufferbloatGrade"], number> = {
  A: 1,
  B: 0.8,
  C: 0.5,
  D: 0.2,
  F: 0,
};

export const SCORE_RULES: ScoreRule[] = [
  {
    id: "download",
    label: "Download speed",
    weight: 24,
    rule: "Log curve — full points at 300 Mbps, ~half at 20 Mbps",
    applicable: (r) => publishedDownload(r) !== null,
    input: (r) => {
      const value = publishedDownload(r);
      return value === null ? "inconclusive" : `${fmt(value)} Mbps`;
    },
    quality: (r) => curve(publishedDownload(r) ?? 0, 300),
  },
  {
    id: "upload",
    label: "Upload speed",
    weight: 16,
    rule: "Log curve — full points at 50 Mbps, ~half at 4 Mbps",
    applicable: (r) => publishedUpload(r) !== null,
    input: (r) => {
      const value = publishedUpload(r);
      return value === null ? "inconclusive" : `${fmt(value)} Mbps`;
    },
    quality: (r) => curve(publishedUpload(r) ?? 0, 50),
  },
  {
    id: "idleLatency",
    label: "Idle latency",
    weight: 12,
    rule: "Full points at ≤8 ms, zero at ≥100 ms, linear between",
    input: (r) => `${Math.round(r.idlePingMs)} ms`,
    quality: (r) => clamp(1 - (r.idlePingMs - 8) / 92, 0, 1),
  },
  {
    id: "bufferbloat",
    label: "Loaded latency / bufferbloat",
    weight: 20,
    rule: "By grade — A 100%, B 80%, C 50%, D 20%, F 0%",
    input: (r) => `grade ${r.bufferbloatGrade} (+${Math.round(r.bufferbloatMs)} ms under load)`,
    quality: (r) => BLOAT_QUALITY[r.bufferbloatGrade],
  },
  {
    id: "jitter",
    label: "Jitter",
    weight: 8,
    rule: "Full points at 0 ms, zero at ≥30 ms, linear between",
    input: (r) => `${r.idleJitterMs.toFixed(1)} ms`,
    quality: (r) => clamp(1 - r.idleJitterMs / 30, 0, 1),
  },
  {
    id: "stability",
    label: "Stability",
    weight: 8,
    rule: "Uses the displayed stability score (spread, spikes, throughput variation, failures, and completion)",
    input: (r) => `${r.stability.score}/100 · ${r.spikes} spike${r.spikes === 1 ? "" : "s"}`,
    quality: (r) => clamp(r.stability.score / 100, 0, 1),
  },
  {
    id: "confidence",
    label: "Test confidence",
    weight: 12,
    rule: "Uses the displayed run-confidence score; low-quality sampling cannot earn a high health score",
    input: (r) => `${r.confidence.score}/100`,
    quality: (r) => clamp(r.confidence.score / 100, 0, 1),
  },
  {
    id: "packetLoss",
    label: "Packet loss",
    weight: 0,
    scored: false,
    rule: "Not scored until a valid end-to-end packet-loss service is available",
    input: () => "Unavailable — no percentage inferred from STUN or failed fetches",
    quality: () => 0,
  },
];

export type ScorePart = {
  id: string;
  label: string;
  weight: number;
  earned: number;
  input: string;
  rule: string;
  scored: boolean;
};

export type ScoreBreakdown = { total: number; parts: ScorePart[] };

export function computeScore(r: TestResult): ScoreBreakdown {
  const applicableWeight = SCORE_RULES.reduce((sum, rule) =>
    rule.scored === false || rule.applicable?.(r) === false ? sum : sum + rule.weight, 0);
  const scale = applicableWeight > 0 ? 100 / applicableWeight : 0;
  const parts = SCORE_RULES.map((c) => {
    const scored = c.scored !== false && c.applicable?.(r) !== false;
    const weight = scored ? Math.round(c.weight * scale * 10) / 10 : 0;
    return {
      id: c.id,
      label: c.label,
      weight,
      earned: scored ? Math.round(c.quality(r) * weight * 10) / 10 : 0,
      input: c.input(r),
      rule: scored ? c.rule : `${c.rule}; omitted because the metric was inconclusive`,
      scored,
    };
  });
  return { total: Math.round(parts.reduce((sum, p) => sum + p.earned, 0)), parts };
}

function fmt(n: number): string {
  return n >= 100 ? String(Math.round(n)) : n.toFixed(1);
}
