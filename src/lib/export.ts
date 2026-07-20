/**
 * Export + methodology. Produces a self-describing JSON payload of everything
 * measured, plus a human-readable methodology block. The full public IP is
 * never included — only the masked form travels in exports.
 */
import { BLOAT_FORMULA } from "./grading";
import { SCORE_RULES } from "./scoring";
import type { TestResult } from "./types";
import type { Verdict } from "./verdict";

export const METHODOLOGY = [
  "NetPulse measures against the Cloudflare speed endpoint (speed.cloudflare.com), an anycast service that routes you to the nearest of Cloudflare's edge locations. Results reflect the path to that edge and will differ from Ookla, Fast.com, Cloudflare's own test, or M-Lab, which use different servers, server counts, and aggregation methods. We do not tune NetPulse to match any of them.",
  "Latency is measured with zero-byte HTTPS requests timed by performance.now() (monotonic, sub-millisecond). HTTP round-trips read slightly higher than raw ICMP ping.",
  "Throughput uses cache-busted, no-store requests. Download is run single-connection then multi-connection; the reported figure is the median of the top half of the multi-connection samples, which discards TCP slow-start. Phases stop early once samples are steady, or at a duration/data cap.",
  "Loaded latency is probed continuously during download and upload; bufferbloat is the increase over idle, graded separately per direction.",
  "Packet loss is experimental: a WebRTC/STUN check reports UDP reachability, not an end-to-end loss percentage.",
  "IP-based location is approximate and reflects network routing (often an ISP point of presence), not your street address. The full public IP is masked and never exported.",
];

export function buildExport(result: TestResult, verdict: Verdict | null) {
  return {
    tool: "NetPulse",
    schemaVersion: result.schemaVersion,
    generatedAt: new Date(result.timestamp).toISOString(),
    methodology: METHODOLOGY,
    scoringFormula: {
      health: SCORE_RULES.map((r) => ({ id: r.id, label: r.label, weight: r.weight, rule: r.rule })),
      bufferbloat: BLOAT_FORMULA,
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
      health_score: verdict?.score ?? "",
      confidence: result.confidence.score,
      download_mbps: result.downloadMbps.toFixed(1),
      upload_mbps: result.uploadMbps.toFixed(1),
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
      server: `${result.server.chosen.provider} ${result.server.chosen.city ?? ""}`.trim(),
      data_mb: Math.round(result.dataUsedMB),
      duration_s: (result.durationMs / 1000).toFixed(1),
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
    `- Download: **${L(r.downloadMbps, 1)} Mbps**  (single ${L(r.download.single.mbps, 1)} / multi ${L(r.download.multi.mbps, 1)})`,
    `- Upload: **${L(r.uploadMbps, 1)} Mbps**  (peak ${L(r.upload.peakMbps, 1)})`,
    `- Idle latency: **${L(r.idlePingMs)} ms**  (p95 ${L(r.idleLatency.p95)}, jitter ${L(r.idleJitterMs, 1)})`,
    `- Loaded latency: down ${L(r.loadedDownPingMs)} ms / up ${L(r.loadedUpPingMs)} ms`,
    `- Bufferbloat: **${r.bufferbloatGrade}** (+${L(r.bufferbloatMs)} ms; down ${r.bufferbloat.downloadGrade} / up ${r.bufferbloat.uploadGrade})`,
    `- Stability: ${r.stability.score}/100 · Packet loss (UDP reachability): ${r.packetLoss.udpReachable}`,
    ``,
    `## Network`,
    `- ISP: ${r.ispLocation.ispHint ?? "unknown"}${r.ispLocation.asn ? ` (${r.ispLocation.asn.split(" ")[0]})` : ""}`,
    `- Region: ${r.ispLocation.region ?? "unknown"}, ${r.ispLocation.country ?? ""}`.replace(/, $/, ""),
    `- Test server: ${r.server.chosen.provider} ${r.server.chosen.city ?? ""}${r.server.chosen.approxDistanceKm != null ? ` (~${r.server.chosen.approxDistanceKm} km)` : ""}`,
    ``,
    `## Diagnosis`,
    ...(verdict?.bad.length ? verdict.bad.map((b) => `- ⚠ ${b}`) : ["- No major problems found."]),
    ``,
    `_Measured with NetPulse against Cloudflare's anycast endpoint. Public IP omitted for privacy. Results reflect the path to the nearest Cloudflare edge and differ from other speed tests by design._`,
  ].join("\n");
}
