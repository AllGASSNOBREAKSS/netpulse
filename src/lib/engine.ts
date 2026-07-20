/**
 * NetPulse measurement engine — orchestrator.
 *
 * Runs the full pipeline: preflight → server selection → idle latency →
 * download (single + multi connection) → upload → packet-loss probe → derive
 * (bufferbloat, stability, confidence) → assemble result. Every stage lives in
 * its own module; this file sequences them, streams events to the UI, tracks
 * tab visibility + errors, and assembles the versioned TestResult.
 *
 * Re-exports Phase / TestResult / pingOnce for the rest of the app.
 */
import { computeConfidence } from "./confidence";
import { computeBufferbloat, computeStability } from "./grading";
import { maskIp } from "./ip";
import { measureIdleLatency } from "./latency";
import { runPreflight } from "./preflight";
import { getServer, selectServer } from "./servers";
import { summarize } from "./stats";
import { downloadPhase, uploadPhase } from "./throughput";
import { probePacketLoss } from "./packetloss";
import {
  SCHEMA_VERSION,
  type EngineCallbacks,
  type IspLocation,
  type Sample,
  type TestConfig,
  type TestResult,
} from "./types";

export type { Phase, TestConfig, TestResult, Sample, EngineCallbacks } from "./types";
export { pingOnce } from "./latency";

/**
 * Per-mode measurement parameters. `dlStreams`/`ulStreams` are read by the
 * speedometer to label the phase "gear" with the stream count that runs.
 */
export const PROFILES = {
  full: {
    idleProbes: 14,
    serverProbes: 6,
    single: { streams: 1, chunkBytes: 25_000_000, minMs: 3000, maxMs: 6000, maxBytes: 80_000_000 },
    multi: { streams: 4, chunkBytes: 25_000_000, minMs: 4000, maxMs: 9000, maxBytes: 220_000_000 },
    upload: { streams: 3, chunkBytes: 2_000_000, minMs: 4000, maxMs: 8000, maxBytes: 70_000_000 },
    dlStreams: 4,
    ulStreams: 3,
  },
  lowData: {
    idleProbes: 10,
    serverProbes: 4,
    single: { streams: 1, chunkBytes: 8_000_000, minMs: 2000, maxMs: 4000, maxBytes: 12_000_000 },
    multi: { streams: 2, chunkBytes: 8_000_000, minMs: 2000, maxMs: 5000, maxBytes: 22_000_000 },
    upload: { streams: 1, chunkBytes: 1_000_000, minMs: 2000, maxMs: 4000, maxBytes: 8_000_000 },
    dlStreams: 2,
    ulStreams: 1,
  },
} as const;

type TraceInfo = Record<string, string>;
async function fetchTrace(serverId: string): Promise<TraceInfo | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const response = await fetch(getServer(serverId).tracePath, { cache: "no-store", signal: ctrl.signal });
    if (!response.ok) return null;
    const t = await response.text();
    const info: TraceInfo = {};
    for (const line of t.trim().split("\n")) {
      const [k, v] = line.split("=");
      if (k && v) info[k] = v;
    }
    return info;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function runTest(cfg: TestConfig, cb: EngineCallbacks): Promise<TestResult> {
  const P = cfg.lowData ? PROFILES.lowData : PROFILES.full;
  const start = performance.now();
  const samples: Sample[] = [];

  // Track whether the tab stayed foreground for the whole run — it gates
  // confidence, because background tabs throttle timers and depress results.
  let tabForegroundThroughout = typeof document === "undefined" || document.visibilityState === "visible";
  const onVis = () => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") tabForegroundThroughout = false;
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVis);

  const push = (s: Omit<Sample, "t">) => {
    const sample = { ...s, t: performance.now() - start };
    samples.push(sample);
    cb.onSample?.(sample);
  };

  try {
    /* ---- 1. Preflight ---- */
    cb.onPhase?.("preflight");
    const preflight = await runPreflight(cfg);
    cb.onPreflight?.(preflight);

    /* ---- 2. Server selection ---- */
    cb.onPhase?.("server");
    const server = await selectServer(P.serverProbes, cfg.serverId);
    cb.onServer?.(server);
    const serverId = server.chosen.id;

    /* ---- 3. Idle latency ---- */
    cb.onPhase?.("latency");
    const { rtts: idleRtts, failed: idleFailed } = await measureIdleLatency(P.idleProbes, serverId, (rtt) =>
      push({ phase: "latency", rttMs: rtt }),
    );
    const idleLatency = summarize(idleRtts);
    if (idleLatency.count === 0) {
      throw new Error("Idle latency measurement failed: every probe to the test endpoint failed.");
    }
    cb.onPartial?.({ idleLatency, idlePingMs: idleLatency.median, idleJitterMs: idleLatency.jitter });

    /* ---- 4. Download: single connection ---- */
    cb.onPhase?.("download_single");
    const single = await downloadPhase({
      serverId,
      streams: P.single.streams,
      minDurationMs: P.single.minMs,
      maxDurationMs: P.single.maxMs,
      maxBytes: P.single.maxBytes,
      chunkBytes: P.single.chunkBytes,
      onThroughput: (mbps) => push({ phase: "download_single", mbps, streamMode: "single" }),
      onRtt: (rtt) => push({ phase: "download_single", rttMs: rtt }),
      onBytes: (bytes) => cb.onBytes?.(bytes),
    });

    /* ---- 4b. Download: multi connection (the headline figure) ---- */
    cb.onPhase?.("download_multi");
    const multi = await downloadPhase({
      serverId,
      streams: P.multi.streams,
      minDurationMs: P.multi.minMs,
      maxDurationMs: P.multi.maxMs,
      maxBytes: P.multi.maxBytes,
      chunkBytes: P.multi.chunkBytes,
      onThroughput: (mbps) => push({ phase: "download_multi", mbps, streamMode: "multi" }),
      onRtt: (rtt) => push({ phase: "download_multi", rttMs: rtt }),
      onBytes: (bytes) => cb.onBytes?.(single.bytes + bytes),
    });
    const loadedDownRtts = [...single.rtts, ...multi.rtts];
    const loadedDown = summarize(loadedDownRtts);
    if (loadedDown.count === 0) {
      throw new Error("Download-loaded latency measurement failed: no probe completed while download load was active.");
    }
    cb.onPartial?.({
      downloadMbps: multi.mbps,
      loadedDown,
      loadedDownPingMs: loadedDown.median,
    });

    /* ---- 5. Upload ---- */
    cb.onPhase?.("upload");
    const upload = await uploadPhase({
      serverId,
      streams: P.upload.streams,
      minDurationMs: P.upload.minMs,
      maxDurationMs: P.upload.maxMs,
      maxBytes: P.upload.maxBytes,
      chunkBytes: P.upload.chunkBytes,
      onThroughput: (mbps) => push({ phase: "upload", mbps, streamMode: "multi" }),
      onRtt: (rtt) => push({ phase: "upload", rttMs: rtt }),
      onBytes: (bytes) => cb.onBytes?.(single.bytes + multi.bytes + bytes),
    });
    const loadedUp = summarize(upload.rtts);
    if (loadedUp.count === 0) {
      throw new Error("Upload-loaded latency measurement failed: no probe completed while upload load was active.");
    }
    cb.onPartial?.({ uploadMbps: upload.mbps, loadedUp, loadedUpPingMs: loadedUp.median });

    /* ---- 6. Packet loss / UDP reachability (experimental) ---- */
    cb.onPhase?.("packetloss");
    const packetLoss = await probePacketLoss();

    /* ---- 7. Derive ---- */
    const bufferbloat = computeBufferbloat(idleLatency, loadedDown, loadedUp);
    const stability = computeStability(
      idleLatency.median,
      [...loadedDownRtts, ...upload.rtts],
      multi.cov,
      upload.cov,
    );

    const trace = await fetchTrace(serverId);
    const rawIp = trace?.ip ?? "";
    const ipFamily: IspLocation["ipFamily"] = rawIp.includes(":") ? "IPv6" : rawIp ? "IPv4" : "unknown";
    const ispLocation: IspLocation = {
      ispHint: null,
      asn: null,
      city: null,
      region: null,
      country: trace?.loc ?? null,
      ipFamily,
      ipMasked: maskIp(rawIp),
      vpnProxy: preflight.vpnProxy,
      note: "Country code comes from Cloudflare's connection trace. Retail ISP, ASN, city, and region are not inferred from the edge code; an explicit opt-in lookup is available in Connection & Privacy.",
    };

    const dataUsedMB = (single.bytes + multi.bytes + upload.bytes) / 1_000_000;
    const requestErrors = single.failedRequests + multi.failedRequests + upload.failedRequests;

    const confidence = computeConfidence({
      downloadSamples: multi.samples,
      uploadSamples: upload.samples,
      idleProbeCount: idleRtts.length,
      idleFailed,
      loadedDownProbeCount: loadedDownRtts.length,
      loadedUpProbeCount: upload.rtts.length,
      serverAvailable: server.chosen.available,
      serverJitterMs: server.chosen.latency.jitter,
      tabForegroundThroughout,
      completed: true,
      errors: requestErrors,
      earlyStopped: single.earlyStopped || multi.earlyStopped || upload.earlyStopped,
    });

    const limitations = buildLimitations({
      lowData: cfg.lowData,
      tabForegroundThroughout,
      idleFailed,
      packetLossExperimental: true,
      earlyStopped: multi.earlyStopped,
      requestErrors,
    });

    cb.onPhase?.("done");
    const result: TestResult = {
      schemaVersion: SCHEMA_VERSION,
      timestamp: Date.now(),
      durationMs: performance.now() - start,
      lowData: cfg.lowData,

      preflight,
      server,

      idleLatency,
      idleFailed,

      download: { single, multi },
      upload,

      loadedDown,
      loadedUp,

      bufferbloat,
      stability,
      packetLoss,
      ispLocation,
      confidence,

      dataUsedMB,
      limitations,
      samples,

      downloadMbps: multi.mbps,
      uploadMbps: upload.mbps,
      idlePingMs: idleLatency.median,
      idleJitterMs: idleLatency.jitter,
      loadedDownPingMs: loadedDown.median,
      loadedUpPingMs: loadedUp.median,
      bufferbloatMs: Math.max(bufferbloat.downloadMs, bufferbloat.uploadMs),
      bufferbloatGrade: bufferbloat.overallGrade,
      spikes: stability.spikes,
      probeCount: loadedDownRtts.length + upload.rtts.length,
    };
    cb.onPartial?.(result);
    return result;
  } finally {
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVis);
  }
}

function buildLimitations(x: {
  lowData: boolean;
  tabForegroundThroughout: boolean;
  idleFailed: number;
  packetLossExperimental: boolean;
  earlyStopped: boolean;
  requestErrors: number;
}): string[] {
  const out: string[] = [];
  if (x.packetLossExperimental)
    out.push("Packet loss is unavailable: the experimental STUN check reports UDP reachability, not true end-to-end loss.");
  out.push("Single test provider (Cloudflare anycast) — results reflect the path to your nearest Cloudflare edge and may differ from Ookla, Fast.com or M-Lab, which use different servers and methods.");
  if (x.lowData) out.push("Low-data mode caps bytes and duration, so figures rest on fewer samples.");
  if (!x.tabForegroundThroughout) out.push("The tab was backgrounded during the test; browser timer throttling may have depressed throughput and latency.");
  if (x.idleFailed > 0) out.push(`${x.idleFailed} idle latency probe(s) failed.`);
  if (x.requestErrors > 0) out.push(`${x.requestErrors} throughput request(s) failed; confidence was reduced.`);
  if (x.earlyStopped)
    out.push("A phase stopped early once throughput samples were steady; the throughput estimate stabilized, but fewer loaded-latency probes can reduce confidence.");
  return out;
}
