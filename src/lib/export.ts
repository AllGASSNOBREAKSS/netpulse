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
  "Throughput uses cache-busted, no-store requests and actual elapsed time for each ~250 ms window plus the final partial window. Download is run single-connection then multi-connection; the reported figure is the median of the top half of the multi-connection samples, which discards TCP slow-start. Phases stop early once samples are steady, or at a duration/payload cap.",
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

export function downloadJson(result: TestResult, verdict: Verdict | null) {
  const blob = new Blob([JSON.stringify(buildExport(result, verdict), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `netpulse-${new Date(result.timestamp).toISOString().replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
