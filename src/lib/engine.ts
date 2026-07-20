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
import { measureIdleLatency, pingOnce } from "./latency";
import { runPreflight } from "./preflight";
import { coloDistanceKm, fetchMeta, selectServer } from "./servers";
import { summarize } from "./stats";
import { downloadPhase, uploadPhase } from "./throughput";
import { probePacketLoss } from "./packetloss";
import {
  SCHEMA_VERSION,
  type EngineCallbacks,
  type IspLocation,
  type Phase,
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
  // Light profile for guided A/B diagnostics — small caps so a multi-step
  // session doesn't consume hundreds of MB. ~15–25 MB per run.
  quick: {
    idleProbes: 8,
    serverProbes: 3,
    single: { streams: 1, chunkBytes: 5_000_000, minMs: 1500, maxMs: 3000, maxBytes: 6_000_000 },
    multi: { streams: 3, chunkBytes: 5_000_000, minMs: 1500, maxMs: 3500, maxBytes: 12_000_000 },
    upload: { streams: 2, chunkBytes: 1_000_000, minMs: 1500, maxMs: 3000, maxBytes: 5_000_000 },
    dlStreams: 3,
    ulStreams: 2,
  },
} as const;

export async function runTest(cfg: TestConfig, cb: EngineCallbacks): Promise<TestResult> {
  const P = PROFILES[cfg.profile ?? (cfg.lowData ? "lowData" : "full")];
  const start = performance.now();
  const samples: Sample[] = [];
  let errors = 0;

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
    });
    const loadedDownRtts = [...single.rtts, ...multi.rtts];
    const loadedDown = summarize(loadedDownRtts);
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
    });
    const loadedUp = summarize(upload.rtts);
    cb.onPartial?.({ uploadMbps: upload.mbps, loadedUp, loadedUpPingMs: loadedUp.median });

    /* ---- 6. Packet loss / UDP reachability (experimental) ---- */
    cb.onPhase?.("packetloss");
    const packetLoss = await probePacketLoss();

    /* ---- 7. Derive ---- */
    const bufferbloat = computeBufferbloat(idleLatency, loadedDown, loadedUp);
    const stability = computeStability(idleLatency.median, [...loadedDownRtts, ...upload.rtts], multi.cov);

    // Real ISP / ASN / geo / distance from Cloudflare's /meta endpoint.
    const meta = await fetchMeta(serverId);
    if (meta) {
      const dist = coloDistanceKm(meta);
      server.chosen.approxDistanceKm = dist;
      server.chosen.region = meta.coloCity ? `${meta.coloCity} (${meta.colo})` : server.chosen.city;
    }
    const ispLocation: IspLocation = {
      ispHint: meta?.org ?? null,
      asn: meta?.asn != null ? `AS${meta.asn}${meta.org ? ` ${meta.org}` : ""}` : null,
      city: meta?.city ?? null,
      region: meta?.region ?? null,
      country: meta?.country ?? null,
      ipFamily: meta?.ipFamily ?? "unknown",
      ipMasked: maskIp(meta?.clientIp ?? ""),
      vpnProxy: preflight.vpnProxy,
      note: "ISP, ASN and location come from Cloudflare's edge view of your connection. Location is approximate and reflects your network's routing region — often an ISP point of presence, not your street address. The full public IP is never stored or exported.",
    };

    const dataUsedMB = (single.bytes + multi.bytes + upload.bytes) / 1_000_000;

    const confidence = computeConfidence({
      downloadSamples: multi.samples,
      idleProbeCount: idleRtts.length,
      idleFailed,
      loadedProbeCount: loadedDownRtts.length + upload.rtts.length,
      serverAvailable: server.chosen.available,
      serverJitterMs: server.chosen.latency.jitter,
      tabForegroundThroughout,
      completed: true,
      errors,
      earlyStopped: single.earlyStopped || multi.earlyStopped || upload.earlyStopped,
    });

    const limitations = buildLimitations({
      lowData: cfg.lowData,
      tabForegroundThroughout,
      idleFailed,
      packetLossExperimental: true,
      earlyStopped: multi.earlyStopped,
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
  } catch (e) {
    errors++;
    throw e;
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
}): string[] {
  const out: string[] = [];
  if (x.packetLossExperimental)
    out.push("Packet loss is experimental: NetPulse checks UDP reachability via STUN, not true end-to-end loss.");
  out.push("Single test provider (Cloudflare anycast) — results reflect the path to your nearest Cloudflare edge and may differ from Ookla, Fast.com or M-Lab, which use different servers and methods.");
  if (x.lowData) out.push("Low-data mode caps bytes and duration, so figures rest on fewer samples.");
  if (!x.tabForegroundThroughout) out.push("The tab was backgrounded during the test; browser timer throttling may have depressed throughput and latency.");
  if (x.idleFailed > 0) out.push(`${x.idleFailed} idle latency probe(s) failed.`);
  if (x.earlyStopped) out.push("A phase stopped early once samples were steady — this is by design and does not reduce accuracy.");
  return out;
}
