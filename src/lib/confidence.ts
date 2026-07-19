/**
 * Result confidence (0–100): how much to trust this particular run. Built from
 * observable facts about the run itself, not the connection quality. Each
 * reason is surfaced in the UI so the score is explainable.
 */
import { coefficientOfVariation } from "./stats";
import type { Confidence, ConfidenceReason } from "./types";

export type ConfidenceInputs = {
  downloadSamples: number[];
  idleProbeCount: number;
  idleFailed: number;
  loadedProbeCount: number;
  serverAvailable: boolean;
  serverJitterMs: number;
  tabForegroundThroughout: boolean;
  completed: boolean;
  errors: number;
  earlyStopped: boolean;
};

export function computeConfidence(i: ConfidenceInputs): Confidence {
  const reasons: ConfidenceReason[] = [];
  let score = 100;

  const dlCount = i.downloadSamples.length;
  if (dlCount >= 16) reasons.push({ label: "Sample volume", ok: true, detail: `${dlCount} download samples` });
  else {
    const penalty = dlCount >= 8 ? 8 : 20;
    score -= penalty;
    reasons.push({ label: "Sample volume", ok: false, detail: `Only ${dlCount} download samples` });
  }

  const cov = coefficientOfVariation(i.downloadSamples.slice(Math.floor(dlCount / 2)));
  if (dlCount < 2) {
    score -= 10;
    reasons.push({ label: "Result consistency", ok: false, detail: "Too few download samples to assess consistency" });
  } else if (cov < 0.1) {
    reasons.push({ label: "Result consistency", ok: true, detail: `Steady throughput (CoV ${cov.toFixed(2)})` });
  } else {
    score -= cov < 0.25 ? 8 : 18;
    reasons.push({ label: "Result consistency", ok: false, detail: `Variable throughput (CoV ${cov.toFixed(2)})` });
  }

  if (i.loadedProbeCount >= 6) {
    reasons.push({ label: "Loaded latency", ok: true, detail: `${i.loadedProbeCount} probes under load` });
  } else {
    const penalty = i.loadedProbeCount >= 2 ? 6 : 20;
    score -= penalty;
    reasons.push({
      label: "Loaded latency",
      ok: false,
      detail:
        i.loadedProbeCount === 0
          ? "No latency probes completed under load"
          : `Only ${i.loadedProbeCount} latency probe${i.loadedProbeCount === 1 ? "" : "s"} completed under load`,
    });
  }

  if (i.serverAvailable && i.serverJitterMs < 15)
    reasons.push({ label: "Server stability", ok: true, detail: `Stable server (${Math.round(i.serverJitterMs)} ms jitter)` });
  else {
    score -= 10;
    reasons.push({
      label: "Server stability",
      ok: false,
      detail: i.serverAvailable ? `High server jitter (${Math.round(i.serverJitterMs)} ms)` : "Server was unreachable",
    });
  }

  if (i.tabForegroundThroughout) reasons.push({ label: "Tab visibility", ok: true, detail: "Foreground for the whole test" });
  else {
    score -= 20;
    reasons.push({
      label: "Tab visibility",
      ok: false,
      detail: "Tab was backgrounded — browsers throttle timers, results may be low",
    });
  }

  if (i.completed) reasons.push({ label: "Completion", ok: true, detail: "All phases finished" });
  else {
    score -= 30;
    reasons.push({ label: "Completion", ok: false, detail: "Test did not complete" });
  }

  const errorTotal = i.errors + i.idleFailed;
  if (errorTotal === 0) reasons.push({ label: "Measurement errors", ok: true, detail: "No failed probes or requests" });
  else {
    score -= Math.min(errorTotal * 3, 15);
    reasons.push({ label: "Measurement errors", ok: false, detail: `${errorTotal} failed probe(s)/request(s)` });
  }

  if (i.earlyStopped)
    reasons.push({ label: "Early stop", ok: true, detail: "Stopped early because samples were already steady" });

  score = Math.max(0, Math.min(100, Math.round(score)));
  const good = reasons.filter((r) => r.ok).map((r) => r.label.toLowerCase());
  const summary =
    score >= 85
      ? `High confidence — ${good.slice(0, 3).join(", ")}.`
      : score >= 60
        ? "Moderate confidence — see the flagged factors below."
        : "Low confidence — re-run in a foreground tab with nothing else using the connection.";

  return { score, reasons, summary };
}
