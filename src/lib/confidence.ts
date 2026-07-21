/**
 * Result confidence (0–100): how much to trust this particular run. Built from
 * observable facts about the run itself, not the connection quality. Each
 * reason is surfaced in the UI so the score is explainable.
 */
import { coefficientOfVariation } from "./stats";
import type { Confidence, ConfidenceReason } from "./types";

export type ConfidenceInputs = {
  downloadSamples: number[];
  uploadSamples: number[];
  idleProbeCount: number;
  idleFailed: number;
  loadedDownProbeCount: number;
  loadedUpProbeCount: number;
  serverAvailable: boolean;
  serverJitterMs: number;
  downloadWarmupSucceeded: boolean;
  uploadWarmupSucceeded: boolean;
  downloadMinimumDurationMet: boolean;
  uploadMinimumDurationMet: boolean;
  tabForegroundThroughout: boolean;
  completed: boolean;
  errors: number;
  earlyStopped: boolean;
};

export function computeConfidence(i: ConfidenceInputs): Confidence {
  const reasons: ConfidenceReason[] = [];
  let score = 100;

  const add = (label: string, ok: boolean, detail: string, penalty = 0) => {
    const appliedPenalty = ok ? 0 : penalty;
    score -= appliedPenalty;
    reasons.push({ label, ok, detail, penalty: appliedPenalty });
  };

  const dlCount = i.downloadSamples.length;
  add("Download sampling", dlCount >= 12, `${dlCount} streamed throughput windows`, dlCount >= 8 ? 6 : 16);

  const ulCount = i.uploadSamples.length;
  add("Upload sampling", ulCount >= 3, `${ulCount} accepted-payload observations`, ulCount > 0 ? 6 : 18);

  const uploadCov = coefficientOfVariation(i.uploadSamples.slice(Math.floor(ulCount / 2)));
  if (ulCount < 2) {
    add("Upload consistency", false, "Too few accepted-payload observations to assess variation", 8);
  } else if (uploadCov < 0.15) {
    add("Upload consistency", true, `Accepted-payload observations were steady (CoV ${uploadCov.toFixed(2)})`);
  } else {
    add(
      "Upload consistency",
      false,
      `Accepted-payload observations varied (CoV ${uploadCov.toFixed(2)})`,
      uploadCov < 0.3 ? 5 : 10,
    );
  }

  add(
    "Idle latency sampling",
    i.idleProbeCount >= 8,
    `${i.idleProbeCount} successful idle probe${i.idleProbeCount === 1 ? "" : "s"}`,
    i.idleProbeCount >= 4 ? 5 : 12,
  );

  const cov = coefficientOfVariation(i.downloadSamples.slice(Math.floor(dlCount / 2)));
  if (dlCount < 2) {
    add("Download consistency", false, "Too few download samples to assess consistency", 10);
  } else if (cov < 0.1) {
    add("Download consistency", true, `Steady throughput (CoV ${cov.toFixed(2)})`);
  } else {
    add("Download consistency", false, `Variable throughput (CoV ${cov.toFixed(2)})`, cov < 0.25 ? 8 : 18);
  }

  add(
    "Download-loaded latency",
    i.loadedDownProbeCount >= 3,
    `${i.loadedDownProbeCount} probe${i.loadedDownProbeCount === 1 ? "" : "s"} during download load`,
    i.loadedDownProbeCount > 0 ? 6 : 16,
  );
  add(
    "Upload-loaded latency",
    i.loadedUpProbeCount >= 3,
    `${i.loadedUpProbeCount} probe${i.loadedUpProbeCount === 1 ? "" : "s"} during upload load`,
    i.loadedUpProbeCount > 0 ? 6 : 16,
  );

  if (i.serverAvailable && i.serverJitterMs < 15)
    add("Server stability", true, `Stable server (${Math.round(i.serverJitterMs)} ms jitter)`);
  else {
    add(
      "Server stability",
      false,
      i.serverAvailable ? `High server jitter (${Math.round(i.serverJitterMs)} ms)` : "Server was unreachable",
      10,
    );
  }

  add(
    "Download warm-up",
    i.downloadWarmupSucceeded,
    i.downloadWarmupSucceeded ? "Connection warmed before timed download" : "Download warm-up failed; fixed request sizing was used",
    4,
  );
  add(
    "Upload warm-up",
    i.uploadWarmupSucceeded,
    i.uploadWarmupSucceeded ? "Connection warmed before timed upload" : "Upload warm-up failed; fixed request sizing was used",
    4,
  );
  add(
    "Download duration",
    i.downloadMinimumDurationMet,
    i.downloadMinimumDurationMet ? "Minimum timed download duration completed" : "Payload cap ended download before its minimum duration",
    6,
  );
  add(
    "Upload duration",
    i.uploadMinimumDurationMet,
    i.uploadMinimumDurationMet ? "Minimum timed upload duration completed" : "Payload cap ended upload before its minimum duration",
    6,
  );

  if (i.tabForegroundThroughout) add("Tab visibility", true, "Foreground for the whole test");
  else {
    add("Tab visibility", false, "Tab was backgrounded — browsers throttle timers, results may be low", 20);
  }

  if (i.completed) add("Completion", true, "All phases finished");
  else {
    add("Completion", false, "Test did not complete", 30);
  }

  const errorTotal = i.errors + i.idleFailed;
  if (errorTotal === 0) add("Measurement errors", true, "No failed probes or requests");
  else {
    add("Measurement errors", false, `${errorTotal} failed probe(s)/request(s)`, Math.min(errorTotal * 3, 15));
  }

  if (i.earlyStopped)
    add("Early stop", true, "Stopped early because samples were already steady");

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
