/** Durable, event-driven NetPulse browser measurement orchestrator. */
import { buildAccuracyPassport } from "./accuracyPassport";
import { isCancellation, linkAbortSignal, MeasurementCancelledError, throwIfCancelled } from "./cancellation";
import { measureDirectionCapacity, type CapacityClientOptions } from "./capacityClient";
import { calibrateClient } from "./clientCalibration";
import { computeConfidence } from "./confidence";
import { computeBufferbloat, computeStability } from "./grading";
import { maskIp } from "./ip";
import { measureIdleLatency } from "./latency";
import {
  createRunId,
  ENGINE_VERSION,
  MeasurementRunRecorder,
  METHODOLOGY_VERSION,
  type MeasurementEventKind,
  type PhaseToken,
  type PipelinePhase,
} from "./measurementPipeline";
import { probePacketLoss } from "./packetloss";
import { runPreflight } from "./preflight";
import { resolveProfile } from "./profiles";
import { buildResultPublication } from "./resultPublication";
import { verifySecondaryDownload } from "./secondaryVerification";
import { getServer, selectServer } from "./servers";
import { summarize } from "./stats";
import { collectTransportTelemetry } from "./transportTelemetry";
import {
  SCHEMA_VERSION,
  type CapacityStage,
  type DirectionCapacity,
  type EngineCallbacks,
  type IspLocation,
  type Sample,
  type TestConfig,
  type TestResult,
  type ThroughputStats,
  type UploadReceiptStatus,
} from "./types";

export type { Phase, TestConfig, TestResult, Sample, EngineCallbacks } from "./types";
export { pingOnce } from "./latency";

type TraceInfo = Record<string, string>;

async function fetchTrace(serverId: string, signal?: AbortSignal): Promise<TraceInfo | null> {
  const tracePath = getServer(serverId).tracePath;
  if (!tracePath) return null;
  const controller = new AbortController();
  const unlink = linkAbortSignal(controller, signal);
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(tracePath, { cache: "no-store", signal: controller.signal });
    if (!response.ok) return null;
    const text = await response.text();
    const info: TraceInfo = {};
    for (const line of text.trim().split("\n")) {
      const [key, value] = line.split("=");
      if (key && value) info[key] = value;
    }
    return info;
  } catch {
    throwIfCancelled(signal);
    return null;
  } finally {
    clearTimeout(timer);
    unlink();
  }
}

export async function runTest(cfg: TestConfig, cb: EngineCallbacks): Promise<TestResult> {
  const profile = resolveProfile(cfg.profile, cfg.lowData);
  const profileMode = cfg.profile ?? (cfg.lowData ? "lowData" : "full");
  const monotonicStart = performance.now();
  const startedAt = Date.now();
  const runId = createRunId(startedAt);
  const recorder = new MeasurementRunRecorder({
    runId,
    startedAt,
    monotonicStart,
    onBatch: cb.onEvents,
  });
  const samples: Sample[] = [];
  const calibration = calibrateClient();
  let tabForegroundThroughout = typeof document === "undefined" || document.visibilityState === "visible";
  const onVisibility = () => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") tabForegroundThroughout = false;
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);

  const push = (value: Omit<Sample, "t">) => {
    const sample = { ...value, t: performance.now() - monotonicStart };
    samples.push(sample);
    cb.onSample?.(sample);
    const isLatency = sample.rttMs !== undefined;
    const phase: PipelinePhase = isLatency
      ? sample.phase === "latency"
        ? "measuring-idle-latency"
        : sample.phase === "upload"
          ? "measuring-upload-loaded-latency"
          : "measuring-download-loaded-latency"
      : sample.phase === "upload"
        ? "measuring-upload"
        : "measuring-download";
    const kind: MeasurementEventKind = isLatency
      ? "latency-sample"
      : sample.phase === "upload"
        ? "upload-progress"
        : "download-progress";
    recorder.emit(kind, phase, {
      ...(sample.mbps === undefined ? {} : { mbps: sample.mbps }),
      ...(sample.rttMs === undefined ? {} : { rttMs: sample.rttMs }),
      ...(sample.streamMode === undefined ? {} : { streamMode: sample.streamMode }),
    });
  };

  const runPhase = async <T>(phase: PipelinePhase, work: () => Promise<T> | T): Promise<T> => {
    const retries = retryCount(cfg, phase);
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      throwIfCancelled(cfg.signal);
      const token = recorder.begin(phase);
      try {
        const value = await work();
        recorder.complete(token);
        return value;
      } catch (error) {
        recorder.fail(token, error, isCancellation(error));
        if (isCancellation(error) || attempt >= retries) throw error;
        recorder.retry(phase, error);
      }
    }
    throw new Error(`Phase ${phase} exhausted its retry policy.`);
  };

  const created = recorder.begin("created");
  recorder.complete(created, { profile: cfg.profile ?? (cfg.lowData ? "lowData" : "full") });

  try {
    cb.onPhase?.("preflight");
    recorder.emit("preflight-started", "preflight", {}, true);
    const preflight = await runPhase("preflight", () => runPreflight(cfg));
    cb.onPreflight?.(preflight);

    cb.onPhase?.("server");
    const server = await selectEndpoint(profile.serverProbes, cfg, recorder);
    cb.onServer?.(server);
    const serverId = server.chosen.id;
    recorder.emit("endpoint-selected", "selecting-endpoint", {
      endpointId: serverId,
      region: server.chosen.regionLabel,
      degraded: server.degraded,
      backups: server.backups.length,
    }, true);
    const transportTelemetry = await runPhase("collecting-transport-telemetry", () => collectTransportTelemetry(serverId, cfg.signal));

    cb.onPhase?.("latency");
    const { rtts: idleRtts, failed: idleFailed } = await runPhase("measuring-idle-latency", () =>
      measureIdleLatency(profile.idleProbes, serverId, (rtt) => push({ phase: "latency", rttMs: rtt }), cfg.signal),
    );
    const idleLatency = summarize(idleRtts);
    if (idleLatency.count === 0) throw new Error("Idle latency measurement failed: every endpoint probe failed.");
    cb.onPartial?.({ idleLatency, idlePingMs: idleLatency.median, idleJitterMs: idleLatency.jitter });

    cb.onPhase?.("download_single");
    let multiDownloadAnnounced = false;
    const downloadCapacity = await runCapacitySegment("download", recorder, cfg, (onStage) => measureDirectionCapacity({
      runId,
      serverId,
      direction: "download",
      profileMode,
      endpointHealth: server.chosen.healthStatus,
      profile: profile.capacityDownload,
      onProgress: (mbps, streams) => push({
        phase: streams === 1 ? "download_single" : "download_multi",
        mbps,
        streamMode: streams === 1 ? "single" : "multi",
      }),
      onLatency: (rtt) => push({ phase: "download_multi", rttMs: rtt }),
      onBytes: cb.onBytes,
      onStage: (stage, streams) => {
        if (stage === "measurement" && streams > 1 && !multiDownloadAnnounced) {
          multiDownloadAnnounced = true;
          cb.onPhase?.("download_multi");
        }
        onStage(stage, streams);
      },
      signal: cfg.signal,
    }));
    const singleStage = downloadCapacity.stages.find((stage) => stage.streams === 1) ?? downloadCapacity.stages[0];
    const maximumDownStage = bestStage(downloadCapacity);
    const single = stageToThroughput(singleStage, downloadCapacity.warmupBytes, downloadCapacity.warmupSucceeded);
    const multi = stageToThroughput(maximumDownStage, 0, downloadCapacity.warmupSucceeded);
    const loadedDownRtts = downloadCapacity.rtts;
    const loadedDown = summarize(loadedDownRtts);
    if (loadedDown.count === 0) throw new Error("Download-loaded latency failed: no probe completed while download load was active.");
    cb.onPartial?.({ downloadMbps: multi.mbps, loadedDown, loadedDownPingMs: loadedDown.median });

    cb.onPhase?.("upload");
    const uploadCapacity = await runCapacitySegment("upload", recorder, cfg, (onStage) => measureDirectionCapacity({
      runId,
      serverId,
      direction: "upload",
      profileMode,
      endpointHealth: server.chosen.healthStatus,
      profile: profile.capacityUpload,
      onProgress: (mbps, streams) => push({ phase: "upload", mbps, streamMode: streams === 1 ? "single" : "multi" }),
      onLatency: (rtt) => push({ phase: "upload", rttMs: rtt }),
      onBytes: (bytes) => cb.onBytes?.(downloadCapacity.bytes + bytes),
      onStage,
      signal: cfg.signal,
    }));
    const upload = stageToThroughput(bestStage(uploadCapacity), uploadCapacity.warmupBytes, uploadCapacity.warmupSucceeded);
    const loadedUp = summarize(uploadCapacity.rtts);
    if (loadedUp.count === 0) throw new Error("Upload-loaded latency failed: no probe completed while upload load was active.");
    cb.onPartial?.({ uploadMbps: upload.mbps, loadedUp, loadedUpPingMs: loadedUp.median });

    cb.onPhase?.("packetloss");
    const packetLoss = await runPhase("measuring-packet-loss", async () => {
      throwIfCancelled(cfg.signal);
      const value = await probePacketLoss(6_000, cfg.signal, getServer(serverId).echoPath);
      throwIfCancelled(cfg.signal);
      recorder.emit("packet-loss-progress", "measuring-packet-loss", { status: value.status, udpReachable: value.udpReachable });
      return value;
    });

    const requestErrors = downloadCapacity.failedRequests + uploadCapacity.failedRequests;
    const loadedFailed = downloadCapacity.failedProbes + uploadCapacity.failedProbes;
    const { bufferbloat, stability } = await runPhase("analyzing-stability", () => ({
      bufferbloat: computeBufferbloat(idleLatency, loadedDown, loadedUp),
      stability: computeStability(
        idleLatency.median,
        [...loadedDownRtts, ...uploadCapacity.rtts],
        multi.cov,
        upload.cov,
        loadedFailed,
        requestErrors,
        true,
      ),
    }));

    const primaryPayloadBytes = downloadCapacity.bytes + uploadCapacity.bytes;
    const secondary = await runPhase("verifying-abnormal-results", async () => {
      recorder.emit("verification-started", "verifying-abnormal-results", {
        backupEndpoints: server.backups.length,
        throughputVerification: server.backups.length > 0,
      }, true);
      const verification = await verifySecondaryDownload({
        server,
        primaryMbps: multi.mbps,
        lowData: cfg.lowData,
        signal: cfg.signal,
        onBytes: (bytes) => cb.onBytes?.(primaryPayloadBytes + bytes),
      });
      recorder.emit("download-completed", "verifying-abnormal-results", {
        endpointId: verification.verification.endpointId,
        status: verification.verification.status,
        mbps: verification.verification.secondaryMbps,
        differencePct: verification.verification.differencePct,
      }, true);
      return verification;
    });

    const trace = await fetchTrace(serverId, cfg.signal);
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
      note: "Country code comes from the selected provider trace when available. ISP, ASN, city, and region are not inferred; optional identity lookup remains user initiated.",
    };

    const confidence = await runPhase("calculating-confidence", () => computeConfidence({
      downloadSamples: multi.samples,
      uploadSamples: upload.samples,
      idleProbeCount: idleRtts.length,
      idleFailed,
      loadedDownProbeCount: loadedDownRtts.length,
      loadedUpProbeCount: uploadCapacity.rtts.length,
      serverAvailable: server.chosen.available,
      serverJitterMs: server.chosen.latency.jitter,
      downloadWarmupSucceeded: single.warmupSucceeded && multi.warmupSucceeded,
      uploadWarmupSucceeded: upload.warmupSucceeded,
      downloadMinimumDurationMet: downloadCapacity.publication.maximum.status === "measured",
      uploadMinimumDurationMet: uploadCapacity.publication.maximum.status === "measured",
      tabForegroundThroughout,
      completed: true,
      errors: requestErrors + loadedFailed,
      earlyStopped: single.earlyStopped || multi.earlyStopped,
      endpointHealth: server.chosen.healthStatus,
      endpointLoadPct: server.chosen.loadPct,
      backupEndpointCount: server.backups.length,
      clientLimited: calibration.likelyClientLimited,
      secondaryVerification: secondary.verification,
      profileMode,
      downloadPublication: downloadCapacity.publication.maximum.status,
      uploadPublication: uploadCapacity.publication.maximum.status,
      uploadReceiptStatus: summarizeUploadReceiptStatus(uploadCapacity),
      semanticConsistency: downloadCapacity.publication.semanticConsistency.valid
        && uploadCapacity.publication.semanticConsistency.valid,
      phaseRetryCount: recorder.events.filter((event) => event.kind === "phase-retry").length,
    }));
    recorder.emit("confidence-updated", "calculating-confidence", { score: confidence.score }, true);
    const publication = buildResultPublication({
      confidence,
      download: downloadCapacity,
      upload: uploadCapacity,
    });

    const limitations = buildLimitations({
      lowData: cfg.lowData,
      tabForegroundThroughout,
      idleFailed,
      packetLossExperimental: packetLoss.packetLossPct === null,
      earlyStopped: multi.earlyStopped,
      requestErrors,
      loadedFailed,
      warmupFailures: [downloadCapacity, uploadCapacity].filter((phase) => !phase.warmupSucceeded).length,
      byteCappedPhases: [
        downloadCapacity.stages.some((stage) => stage.stopReason === "data-cap") ? "download-capacity" : null,
        uploadCapacity.stages.some((stage) => stage.stopReason === "data-cap") ? "upload-capacity" : null,
      ].filter((phase): phase is string => phase !== null),
      server,
      secondaryStatus: secondary.verification.status,
      packetLossTransport: packetLoss.transport,
    });
    limitations.push(...calibration.warnings.map((warning) => `Client calibration: ${warning}`));
    limitations.push(...downloadCapacity.reducedConfidenceReasons.map((reason) => `Download capacity: ${reason}`));
    limitations.push(...uploadCapacity.reducedConfidenceReasons.map((reason) => `Upload capacity: ${reason}`));

    const durationMs = performance.now() - monotonicStart;
    const dataBytes = primaryPayloadBytes + (secondary.throughput ? payloadBytes(secondary.throughput) : 0);
    const terminalPhase: PipelinePhase = confidence.score < 60 ? "low-confidence" : "completed";
    const terminal = recorder.begin(terminalPhase);
    recorder.emit("test-completed", terminalPhase, { confidence: confidence.score, lowConfidence: confidence.score < 60 }, true);
    recorder.complete(terminal);
    recorder.dispose();

    const rawEvidence = {
      engineVersion: ENGINE_VERSION,
      methodologyVersion: METHODOLOGY_VERSION,
      calibration,
      phases: recorder.phases.map((phase) => ({ ...phase })),
      events: recorder.events.map((event) => ({ ...event, data: { ...event.data } })),
      streamDiagnostics: [
        ...downloadCapacity.diagnostics,
        ...uploadCapacity.diagnostics,
        ...(secondary.throughput?.diagnostics ?? []),
      ],
    };
    const accuracyPassport = buildAccuracyPassport({
      confidence,
      samples,
      idleFailed,
      download: multi,
      upload,
      server,
      dataBytes,
      durationMs,
      ipFamily,
      browserForeground: tabForegroundThroughout,
      limitations,
      calibration,
      phases: rawEvidence.phases,
      events: rawEvidence.events,
      secondaryVerification: secondary.verification,
      transportTelemetry,
      ipComparison: preflight.ipComparison,
      resultPublication: publication,
      downloadCapacity,
      uploadCapacity,
    });
    const dataUsedMB = dataBytes / 1_000_000;

    cb.onPhase?.("done");
    const result: TestResult = {
      schemaVersion: SCHEMA_VERSION,
      runId,
      engineVersion: ENGINE_VERSION,
      methodologyVersion: METHODOLOGY_VERSION,
      timestamp: startedAt,
      durationMs,
      lowData: cfg.lowData,
      preflight,
      server,
      idleLatency,
      idleFailed,
      download: { single, multi },
      upload,
      capacity: { download: downloadCapacity, upload: uploadCapacity },
      loadedDown,
      loadedUp,
      bufferbloat,
      stability,
      packetLoss,
      transportTelemetry,
      ispLocation,
      confidence,
      publication,
      accuracyPassport,
      rawEvidence,
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
      probeCount: loadedDownRtts.length + uploadCapacity.rtts.length,
    };
    cb.onPartial?.(result);
    return result;
  } catch (error) {
    const cancelled = isCancellation(error) || cfg.signal?.aborted === true;
    const terminalPhase: PipelinePhase = cancelled ? "cancelled" : "failed";
    const terminal = recorder.begin(terminalPhase);
    recorder.fail(terminal, error, cancelled);
    recorder.emit(cancelled ? "test-cancelled" : "test-failed", terminalPhase, {
      message: error instanceof Error ? error.message.slice(0, 240) : "Unknown measurement failure.",
    }, true);
    cb.onPhase?.("error");
    if (cancelled && !isCancellation(error)) throw new MeasurementCancelledError();
    throw error;
  } finally {
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
    recorder.dispose();
  }
}

async function selectEndpoint(
  probes: number,
  cfg: TestConfig,
  recorder: MeasurementRunRecorder,
): Promise<TestResult["server"]> {
  let token: PhaseToken | null = null;
  let current: PipelinePhase | null = null;
  const move = (phase: PipelinePhase) => {
    if (token && current) recorder.complete(token);
    current = phase;
    token = recorder.begin(phase);
  };
  try {
    const selected = await selectServer(probes, cfg.serverId, {
      signal: cfg.signal,
      onStage: (stage) => move(stage === "discovering" ? "discovering-endpoints" : stage === "probing" ? "probing-endpoints" : "selecting-endpoint"),
      onProbe: (probe) => recorder.emit("endpoint-probe", "probing-endpoints", {
        endpointId: probe.id,
        available: probe.available,
        medianMs: probe.latency.median,
        p95Ms: probe.latency.p95,
        jitterMs: probe.latency.jitter,
        loadPct: probe.loadPct,
      }),
    });
    if (token) recorder.complete(token);
    return selected;
  } catch (error) {
    if (token) recorder.fail(token, error, isCancellation(error));
    throw error;
  }
}

async function runCapacitySegment(
  direction: "download" | "upload",
  recorder: MeasurementRunRecorder,
  cfg: TestConfig,
  work: (onStage: NonNullable<CapacityClientOptions["onStage"]>) => Promise<DirectionCapacity>,
): Promise<DirectionCapacity> {
  const phase: PipelinePhase = direction === "download" ? "measuring-download" : "measuring-upload";
  const loadedPhase: PipelinePhase = direction === "download" ? "measuring-download-loaded-latency" : "measuring-upload-loaded-latency";
  const warmupPhase: PipelinePhase = direction === "download" ? "warming-up-download" : "warming-up-upload";
  const retries = retryCount(cfg, phase);

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    throwIfCancelled(cfg.signal);
    const warmup = recorder.begin(warmupPhase);
    let measured: PhaseToken | null = null;
    let loaded: PhaseToken | null = null;
    try {
      const value = await work((stage, streams) => {
        if (stage !== "measurement") return;
        if (!measured) {
          recorder.complete(warmup, { nextStreams: streams });
          measured = recorder.begin(phase, { streams });
          loaded = recorder.begin(loadedPhase, { streams });
        } else {
          recorder.emit(direction === "download" ? "download-progress" : "upload-progress", phase, { streams });
        }
      });
      if (!measured) measured = recorder.begin(phase);
      if (!loaded) loaded = recorder.begin(loadedPhase);
      recorder.emit(direction === "download" ? "download-completed" : "upload-completed", phase, {
        mbps: value.maximumMbps,
        reliableMbps: value.reliable.mbps,
        streams: value.selectedStreams,
      }, true);
      recorder.complete(measured, {
        mbps: value.maximumMbps,
        reliableMbps: value.reliable.mbps,
        streams: value.selectedStreams,
      });
      recorder.complete(loaded, { samples: value.rtts.length });
      return value;
    } catch (error) {
      recorder.fail(warmup, error, isCancellation(error));
      if (measured) recorder.fail(measured, error, isCancellation(error));
      if (loaded) recorder.fail(loaded, error, isCancellation(error));
      if (isCancellation(error) || attempt >= retries) throw error;
      recorder.retry(phase, error);
    }
  }
  throw new Error(`${direction} phase exhausted its retry policy.`);
}

function bestStage(capacity: DirectionCapacity): CapacityStage {
  return capacity.stages.find((stage) => stage.streams === capacity.selectedStreams)
    ?? capacity.stages.reduce((best, stage) => stage.p50Mbps > best.p50Mbps ? stage : best);
}

function stageToThroughput(
  stage: CapacityStage,
  warmupBytes: number,
  warmupSucceeded: boolean,
): ThroughputStats {
  return {
    mbps: stage.p50Mbps,
    peakMbps: stage.peakMbps,
    medianMbps: stage.medianMbps,
    p5Mbps: stage.p5Mbps,
    p95Mbps: stage.p95Mbps,
    variationPct: stage.variationPct,
    samples: stage.samples,
    cov: coefficientFromPercent(stage.variationPct),
    bytes: stage.bytes,
    warmupBytes,
    warmupSucceeded,
    requestBytes: stage.requestBytes,
    streams: stage.streams,
    calibrationMbps: null,
    durationMs: stage.durationMs,
    earlyStopped: stage.stopReason === "stable",
    stableAtMs: stage.stopReason === "stable" ? stage.durationMs : null,
    stopReason: stage.stopReason,
    failedRequests: stage.failedRequests,
    failedProbes: stage.failedProbes,
    diagnostics: stage.diagnostics,
  };
}

function coefficientFromPercent(variationPct: number): number {
  return Math.max(0, variationPct) / 100;
}

function retryCount(cfg: TestConfig, phase: PipelinePhase): number {
  return Math.max(0, Math.min(2, cfg.phaseRetries?.[phase] ?? 0));
}

function buildLimitations(input: {
  lowData: boolean;
  tabForegroundThroughout: boolean;
  idleFailed: number;
  packetLossExperimental: boolean;
  earlyStopped: boolean;
  requestErrors: number;
  loadedFailed: number;
  warmupFailures: number;
  byteCappedPhases: string[];
  server: TestResult["server"];
  secondaryStatus: TestResult["accuracyPassport"]["secondaryVerification"]["status"];
  packetLossTransport: TestResult["packetLoss"]["transport"];
}): string[] {
  const limitations: string[] = [];
  if (input.packetLossExperimental) limitations.push(input.packetLossTransport === "websocket-echo"
    ? "Packet-loss percentage unavailable: controlled WebSocket echo measures application-message delivery over reliable TCP, which hides network packet loss through retransmission."
    : "Packet-loss measurement unavailable: STUN reports UDP reachability, not end-to-end loss.");
  if (input.server.candidates.filter((candidate) => candidate.available).length <= 1) limitations.push(`Single reachable endpoint (${input.server.chosen.provider}, ${input.server.chosen.regionLabel}); independent throughput verification was unavailable.`);
  else if (input.secondaryStatus === "disagree") limitations.push("Primary and secondary throughput measurements disagreed; neither value was averaged or silently substituted.");
  else if (input.secondaryStatus !== "agree") limitations.push("An independent endpoint was reachable, but secondary throughput agreement was not established.");
  if (input.server.degraded) limitations.push("Endpoint selection was degraded because alternatives or health/load/capacity telemetry were unavailable.");
  if (input.server.directoryWarning) limitations.push(`Endpoint discovery warning: ${input.server.directoryWarning}`);
  if (input.lowData) limitations.push("Low-data mode caps bytes and duration, so estimates use fewer samples.");
  if (!input.tabForegroundThroughout) limitations.push("The tab was backgrounded; browser throttling may have depressed results.");
  if (input.idleFailed > 0) limitations.push(`${input.idleFailed} idle-latency probe(s) failed.`);
  if (input.requestErrors > 0) limitations.push(`${input.requestErrors} throughput request(s) failed; confidence was reduced.`);
  if (input.loadedFailed > 0) limitations.push(`${input.loadedFailed} loaded-latency probe(s) failed; confidence was reduced.`);
  if (input.warmupFailures > 0) limitations.push(`${input.warmupFailures} transfer warm-up(s) failed; fixed sizing was used.`);
  if (input.byteCappedPhases.length > 0) limitations.push(`Payload caps ended ${input.byteCappedPhases.join(", ")} before another request began.`);
  if (input.earlyStopped) limitations.push("A phase stopped after its measured steady-window criterion was satisfied.");
  return limitations;
}

function payloadBytes(stats: { bytes: number; warmupBytes: number }): number {
  return stats.bytes + stats.warmupBytes;
}

function summarizeUploadReceiptStatus(capacity: DirectionCapacity): UploadReceiptStatus {
  const receipts = capacity.diagnostics
    .filter((item) => item.direction === "upload" && item.stage === "measurement" && item.outcome === "completed")
    .flatMap((item) => item.uploadReceipt === null ? [] : [item.uploadReceipt]);
  if (receipts.some((receipt) => receipt.status === "mismatch")) return "mismatch";
  if (receipts.some((receipt) => receipt.status === "invalid")) return "invalid";
  if (receipts.length === 0 || receipts.some((receipt) => receipt.status === "missing")) return "missing";
  if (receipts.every((receipt) => receipt.status === "verified")) return "verified";
  return "partial";
}
