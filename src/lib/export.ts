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
  "NetPulse measures against the endpoint selected from its validated directory. The checked-in public fallback is Cloudflare anycast; future NetPulse-operated regions remain unsupported until deployed and independently validated. Results reflect the chosen route and can differ from Ookla, Fast.com, Cloudflare, or M-Lab because servers, stream counts, duration, and aggregation differ. We do not tune NetPulse to match them.",
  "Latency is measured with zero-byte HTTPS requests timed by performance.now() (monotonic, sub-millisecond). HTTP round-trips read slightly higher than raw ICMP ping.",
  "Throughput uses discarded connection warm-ups, adaptive request payloads, adaptive concurrency, and cache-busted no-store requests. Download runs single-connection then multi-connection. The aggregate result is measured application payload divided by actual phase time; measured windows provide P5, median, P95, peak, and variation context. Upload uses cumulative successfully submitted payload observations because Fetch exposes no byte-level upload progress or server-received byte receipt.",
  "Download and upload run sequentially so loaded latency stays attributable to one direction. A simultaneous full-duplex stress test answers a different question and would not make NetPulse identical to services using different endpoints or aggregation methods.",
  "Loaded latency is probed continuously during download and upload; bufferbloat is the increase over idle, graded separately per direction.",
  "Packet loss is unavailable: the experimental WebRTC/STUN card reports UDP reachability, not an end-to-end loss percentage.",
  "The automatic Cloudflare trace supplies only a country code, serving edge code, IP family, and masked IP. ISP, ASN, city, and region are not inferred. The optional metadata lookup is user-initiated and is not part of test exports.",
];

export function buildExport(result: TestResult, verdict: Verdict | null) {
  return {
    tool: "NetPulse",
    schemaVersion: result.schemaVersion,
    runId: result.runId,
    engineVersion: result.engineVersion,
    methodologyVersion: result.methodologyVersion,
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
    accuracyPassport: result.accuracyPassport,
    rawSamples: result.samples,
    rawEvidence: result.rawEvidence,
  };
}

/* ---- Generic download / CSV helpers --------------------------------------- */
export function downloadText(filename: string, text: string, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function toCsv(rows: Record<string, string | number>[]): string {
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

export function downloadCsv(filename: string, rows: Record<string, string | number>[]) {
  downloadText(filename, toCsv(rows), "text/csv");
}

const stamp = (ts: number) => new Date(ts).toISOString().replace(/[:.]/g, "-");

export function downloadJson(result: TestResult, verdict: Verdict | null) {
  downloadText(`netpulse-${stamp(result.timestamp)}.json`, JSON.stringify(buildExport(result, verdict), null, 2), "application/json");
}

/** Flatten a result to a single CSV row of the headline metrics. */
export function resultCsvRows(result: TestResult, verdict: Verdict | null): Record<string, string | number>[] {
  return [
    {
      timestamp: new Date(result.timestamp).toISOString(),
      run_id: result.runId,
      engine_version: result.engineVersion,
      health_score: verdict?.score ?? "",
      confidence: result.confidence.score,
      download_mbps: result.downloadMbps.toFixed(1),
      download_p90_window_mbps: percentile(result.download.multi.samples, 90).toFixed(1),
      download_p5_window_mbps: result.download.multi.p5Mbps.toFixed(1),
      download_p95_window_mbps: result.download.multi.p95Mbps.toFixed(1),
      download_median_window_mbps: result.download.multi.medianMbps.toFixed(1),
      download_peak_window_mbps: result.download.multi.peakMbps.toFixed(1),
      download_variation_pct: result.download.multi.variationPct.toFixed(1),
      upload_mbps: result.uploadMbps.toFixed(1),
      upload_median_observation_mbps: result.upload.medianMbps.toFixed(1),
      upload_peak_observation_mbps: result.upload.peakMbps.toFixed(1),
      upload_variation_pct: result.upload.variationPct.toFixed(1),
      download_streams: result.download.multi.streams,
      upload_streams: result.upload.streams,
      idle_latency_ms: Math.round(result.idlePingMs),
      loaded_down_ms: Math.round(result.loadedDownPingMs),
      loaded_up_ms: Math.round(result.loadedUpPingMs),
      jitter_ms: result.idleJitterMs.toFixed(1),
      bufferbloat_ms: Math.round(result.bufferbloatMs),
      bufferbloat_grade: result.bufferbloatGrade,
      stability: result.stability.score,
      udp_reachable: result.packetLoss.udpReachable,
      isp: result.ispLocation.ispHint ?? "",
      asn: result.ispLocation.asn ?? "",
      server: `${result.server.chosen.provider}${result.server.chosen.edgeCode ? ` ${result.server.chosen.edgeCode}` : ""}`.trim(),
      data_mb: Math.round(result.dataUsedMB),
      duration_s: (result.durationMs / 1000).toFixed(1),
      download_stop_reason: result.download.multi.stopReason,
      upload_stop_reason: result.upload.stopReason,
      download_request_bytes: result.download.multi.requestBytes,
      upload_request_bytes: result.upload.requestBytes,
      warmup_payload_bytes: result.download.single.warmupBytes + result.download.multi.warmupBytes + result.upload.warmupBytes,
    },
  ];
}

export function downloadCsvResult(result: TestResult, verdict: Verdict | null) {
  downloadCsv(`netpulse-${stamp(result.timestamp)}.csv`, resultCsvRows(result, verdict));
}

/** Privacy-safe shareable report (Markdown). No full IP; precise city omitted. */
export function buildShareReport(result: TestResult, verdict: Verdict | null): string {
  const r = result;
  const L = (n: number, d = 0) => n.toFixed(d);
  return [
    `# NetPulse report`,
    ``,
    `**Overall health:** ${verdict?.score ?? "—"}/100 — ${verdict?.headline ?? ""}`,
    `**Result confidence:** ${r.confidence.score}% (${r.confidence.summary})`,
    ``,
    `## Metrics`,
    `- Download: **${L(r.downloadMbps, 1)} Mbps** aggregate (P5/P95 windows ${L(r.download.multi.p5Mbps, 1)}/${L(r.download.multi.p95Mbps, 1)}; single ${L(r.download.single.mbps, 1)})`,
    `- Upload: **${L(r.uploadMbps, 1)} Mbps** successfully submitted payload (peak observation ${L(r.upload.peakMbps, 1)})`,
    `- Idle latency: **${L(r.idlePingMs)} ms**  (p95 ${L(r.idleLatency.p95)}, jitter ${L(r.idleJitterMs, 1)})`,
    `- Loaded latency: down ${L(r.loadedDownPingMs)} ms / up ${L(r.loadedUpPingMs)} ms`,
    `- Bufferbloat: **${r.bufferbloatGrade}** (+${L(r.bufferbloatMs)} ms; down ${r.bufferbloat.downloadGrade} / up ${r.bufferbloat.uploadGrade})`,
    `- Stability: ${r.stability.score}/100 · Packet loss (UDP reachability): ${r.packetLoss.udpReachable}`,
    ``,
    `## Network`,
    `- ISP: ${r.ispLocation.ispHint ?? "unknown"}${r.ispLocation.asn ? ` (${r.ispLocation.asn.split(" ")[0]})` : ""}`,
    `- Region: ${r.ispLocation.region ?? "unknown"}, ${r.ispLocation.country ?? ""}`.replace(/, $/, ""),
    `- Test server: ${r.server.chosen.provider}${r.server.chosen.edgeCode ? ` (edge ${r.server.chosen.edgeCode})` : ""}`,
    ``,
    `## Diagnosis`,
    ...(verdict?.bad.length ? verdict.bad.map((b) => `- ⚠ ${b}`) : ["- No major problems found."]),
    ``,
    `_Measured with NetPulse against Cloudflare's anycast endpoint. Public IP omitted for privacy. Results reflect the path to the nearest Cloudflare edge and differ from other speed tests by design._`,
  ].join("\n");
}
