/**
 * Export + methodology. Produces a self-describing JSON payload of everything
 * measured, plus a human-readable methodology block. The full public IP is
 * never included — only the masked form travels in exports.
 */
import { BLOAT_FORMULA, STABILITY_FORMULA } from "./grading";
import { SCORE_RULES } from "./scoring";
import { percentile } from "./stats";
import type { TestResult } from "./types";
import type { Verdict } from "./verdict";

export const METHODOLOGY = [
  "NetPulse measures against the Cloudflare speed endpoint (speed.cloudflare.com), an anycast service that routes you to the nearest of Cloudflare's edge locations. Results reflect the path to that edge and will differ from Ookla, Fast.com, Cloudflare's own test, or M-Lab, which use different servers, server counts, and aggregation methods. We do not tune NetPulse to match any of them.",
  "Latency is measured with zero-byte HTTPS requests timed by performance.now() (monotonic, sub-millisecond). HTTP round-trips read slightly higher than raw ICMP ping.",
  "Throughput uses a discarded connection warm-up, adaptive request payloads, and cache-busted no-store requests. Download runs single-connection then multi-connection. Each aggregate result is measured application payload divided by the phase's actual elapsed time; download windows provide median, P90 capacity context, peak observation, and variation. Upload uses cumulative accepted-payload observations because Fetch exposes no byte-level upload progress. The stop reason, duration, request size, payload, and warm-up outcome are retained.",
  "Download and upload run sequentially so loaded latency remains attributable to one direction. A simultaneous full-duplex stress test would answer a different question and would not make NetPulse identical to tests using different providers or aggregation methods.",
  "Loaded latency is probed continuously during download and upload; bufferbloat is the increase over idle, graded separately per direction.",
  "Packet loss is unavailable: the experimental WebRTC/STUN card reports UDP reachability, not an end-to-end loss percentage.",
  "The automatic Cloudflare trace supplies only a country code, serving edge code, IP family, and masked IP. ISP, ASN, city, and region are not inferred. The optional metadata lookup is user-initiated and is not part of test exports.",
];

export function buildExport(result: TestResult, verdict: Verdict | null) {
  return {
    tool: "NetPulse",
    schemaVersion: result.schemaVersion,
    generatedAt: new Date(result.timestamp).toISOString(),
    methodology: METHODOLOGY,
    scoringFormula: {
      health: SCORE_RULES.map((r) => ({ id: r.id, label: r.label, weight: r.weight, scored: r.scored !== false, rule: r.rule })),
      bufferbloat: BLOAT_FORMULA,
      stability: STABILITY_FORMULA,
    },
    config: { lowData: result.lowData },
    preflight: result.preflight,
    server: {
      chosen: result.server.chosen,
      candidates: result.server.candidates,
      reason: result.server.reason,
      manual: result.server.manual,
    },
    results: {
      score: verdict?.score ?? null,
      confidence: result.confidence,
      download: result.download,
      upload: result.upload,
      idleLatency: result.idleLatency,
      loadedDown: result.loadedDown,
      loadedUp: result.loadedUp,
      bufferbloat: result.bufferbloat,
      stability: result.stability,
      packetLoss: result.packetLoss,
    },
    ispLocation: result.ispLocation, // ipMasked only
    dataTransferredMB: Math.round(result.dataUsedMB),
    durationMs: Math.round(result.durationMs),
    limitations: result.limitations,
    rawSamples: result.samples,
  };
}

export function downloadJson(result: TestResult, verdict: Verdict | null) {
  downloadBlob(
    JSON.stringify(buildExport(result, verdict), null, 2),
    "application/json",
    `netpulse-${timestampSlug(result)}.json`,
  );
}

export function downloadCsv(result: TestResult, verdict: Verdict | null) {
  const rows: Array<[string, string | number, string, string]> = [
    ["internet_health", verdict?.score ?? "", "score_0_100", "calculated"],
    ["result_confidence", result.confidence.score, "score_0_100", "calculated"],
    ["download_reliable", result.download.multi.mbps, "Mbps", "measured"],
    ["download_p90_window", percentile(result.download.multi.samples, 90), "Mbps", "calculated_from_measured_windows"],
    ["download_median_window", result.download.multi.medianMbps, "Mbps", "measured"],
    ["download_peak_window", result.download.multi.peakMbps, "Mbps", "measured"],
    ["download_variation", result.download.multi.variationPct, "percent", "calculated"],
    ["upload_reliable", result.uploadMbps, "Mbps", "measured"],
    ["upload_median_observation", result.upload.medianMbps, "Mbps", "measured"],
    ["upload_peak_observation", result.upload.peakMbps, "Mbps", "measured"],
    ["upload_variation_observation", result.upload.variationPct, "percent", "calculated"],
    ["idle_latency_median", result.idleLatency.median, "ms", "measured"],
    ["idle_latency_p95", result.idleLatency.p95, "ms", "calculated"],
    ["idle_latency_p99", result.idleLatency.p99, "ms", "calculated"],
    ["idle_jitter", result.idleLatency.jitter, "ms", "calculated"],
    ["download_loaded_latency_median", result.loadedDown.median, "ms", "measured"],
    ["upload_loaded_latency_median", result.loadedUp.median, "ms", "measured"],
    ["download_bufferbloat", result.bufferbloat.downloadMs, "ms", "calculated"],
    ["upload_bufferbloat", result.bufferbloat.uploadMs, "ms", "calculated"],
    ["stability", result.stability.score, "score_0_100", "calculated"],
    ["packet_loss", "unavailable", "", "unavailable"],
    ["payload_transferred", result.dataUsedMB, "MB", "measured_application_payload"],
    ["test_duration", result.durationMs, "ms", "measured"],
  ];
  const csv = ["metric,value,unit,provenance", ...rows.map((row) => row.map(csvCell).join(","))].join("\r\n");
  downloadBlob(csv, "text/csv;charset=utf-8", `netpulse-${timestampSlug(result)}.csv`);
}

export function downloadDiagnosticReport(result: TestResult, verdict: Verdict | null) {
  const lines = [
    "NetPulse diagnostic report",
    `Generated: ${new Date(result.timestamp).toISOString()}`,
    `Server: ${result.server.chosen.provider} edge ${result.server.chosen.edgeCode ?? "unavailable"}`,
    `IP: ${result.ispLocation.ipMasked || "unavailable"} (${result.ispLocation.ipFamily})`,
    "",
    `Internet health: ${verdict?.score ?? "unavailable"}/100`,
    `Result confidence: ${result.confidence.score}/100 — ${result.confidence.summary}`,
    `Download: ${result.downloadMbps.toFixed(2)} Mbps aggregate; ${percentile(result.download.multi.samples, 90).toFixed(2)} Mbps P90 window; ${result.download.multi.medianMbps.toFixed(2)} Mbps median window; ${result.download.multi.variationPct.toFixed(1)}% variation`,
    `Upload: ${result.uploadMbps.toFixed(2)} Mbps reliable; ${result.upload.medianMbps.toFixed(2)} Mbps median accepted observation; ${result.upload.variationPct.toFixed(1)}% observed variation`,
    `Idle latency: ${result.idleLatency.median.toFixed(1)} ms median; P95 ${result.idleLatency.p95.toFixed(1)} ms; P99 ${result.idleLatency.p99.toFixed(1)} ms`,
    `Loaded latency: ${result.loadedDown.median.toFixed(1)} ms download; ${result.loadedUp.median.toFixed(1)} ms upload`,
    `Jitter: ${result.idleLatency.jitter.toFixed(1)} ms mean consecutive RTT difference`,
    `Bufferbloat: +${result.bufferbloat.downloadMs.toFixed(1)} ms download (${result.bufferbloat.downloadGrade}); +${result.bufferbloat.uploadMs.toFixed(1)} ms upload (${result.bufferbloat.uploadGrade})`,
    `Stability: ${result.stability.score}/100; ${result.stability.spikes} spike(s); ${(result.stability.completeness * 100).toFixed(0)}% loaded-probe completeness`,
    "Packet loss: unavailable — STUN reachability is not an end-to-end loss measurement.",
    `Payload: ${result.dataUsedMB.toFixed(1)} MB application data including warm-ups; duration ${(result.durationMs / 1000).toFixed(1)} s`,
    "",
    "Evidence-based diagnosis",
    ...(verdict?.bad.length ? verdict.bad.map((item) => `- Needs attention: ${item}`) : ["- No measured threshold triggered a warning."]),
    ...(verdict?.actions.map((item) => `- Action: ${item}`) ?? []),
    "",
    "Run limitations",
    ...result.limitations.map((item) => `- ${item}`),
    "",
    "This privacy-safe report contains no full public IP or exact coordinates.",
  ];
  downloadBlob(lines.join("\r\n"), "text/plain;charset=utf-8", `netpulse-report-${timestampSlug(result)}.txt`);
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function timestampSlug(result: TestResult): string {
  return new Date(result.timestamp).toISOString().replace(/[:.]/g, "-");
}

function downloadBlob(contents: string, type: string, filename: string) {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
