import { coefficientOfVariation, max, median, percentile } from "./stats";
import type { CapacityPlan } from "./capacityProtocol";
import type { CapacityStage, DirectionCapacity, StreamDiagnostic } from "./types";

type CapacityCallbacks = {
  onStage?: (stage: "warmup" | "measurement", streams: number) => void;
  onProgress?: (mbps: number, bytes: number, streams: number) => void;
  onLatency?: (rttMs: number) => void;
  onDiagnostic?: (diagnostic: StreamDiagnostic) => void;
};

type WarmupResult = {
  bytes: number;
  durationMs: number;
  transferMbps: number | null;
  succeeded: boolean;
  diagnostic: StreamDiagnostic;
};

const SAMPLE_INTERVAL_MS = 500;
let requestSequence = 0;

export function applicationMbps(bytes: number, durationMs: number): number {
  if (!Number.isFinite(bytes) || !Number.isFinite(durationMs) || bytes < 0 || durationMs <= 0) return 0;
  return (bytes * 8) / durationMs / 1000;
}

function cacheId(): string {
  requestSequence = (requestSequence + 1) % Number.MAX_SAFE_INTEGER;
  return `${Math.round(performance.now() * 1000).toString(36)}-${requestSequence.toString(36)}`;
}

function cacheBust(url: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}np_capacity=${cacheId()}`;
}

function downloadUrl(template: string, bytes: number): string {
  return template.replace("{bytes}", String(Math.max(0, Math.floor(bytes))));
}

function canonicalEndpoint(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "unavailable";
  }
}

function headerInteger(value: string | null): number | null {
  if (!value) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function assertUncompressed(response: Response): void {
  const encoding = response.headers.get("content-encoding");
  if (encoding !== null && encoding.toLowerCase() !== "identity") {
    throw new Error(`Compressed measurement response (${encoding}) is not valid for capacity accounting.`);
  }
}

function protocolFor(url: string): string | null {
  const entries = performance.getEntriesByName?.(url, "resource") as PerformanceResourceTiming[] | undefined;
  return entries?.at(-1)?.nextHopProtocol || null;
}

function diagnostic(input: {
  plan: CapacityPlan;
  stage: "warmup" | "measurement";
  stageStreams: number;
  streamId: number;
  requestId: number;
  url: string;
  startedAtMs: number;
  responseAtMs: number | null;
  firstByteAtMs: number | null;
  endedAtMs: number;
  bytes: number;
  response: Response | null;
  outcome: StreamDiagnostic["outcome"];
  failureReason: string | null;
}): StreamDiagnostic {
  const transferStart = input.plan.direction === "download"
    ? input.firstByteAtMs
    : input.responseAtMs === null ? null : input.startedAtMs;
  const transferDurationMs = transferStart === null ? null : Math.max(0, input.endedAtMs - transferStart);
  return {
    direction: input.plan.direction,
    stage: input.stage,
    stageStreams: input.stageStreams,
    streamId: input.streamId,
    requestId: input.requestId,
    endpoint: canonicalEndpoint(input.url),
    startedAtMs: input.startedAtMs,
    responseAtMs: input.responseAtMs,
    firstByteAtMs: input.firstByteAtMs,
    endedAtMs: input.endedAtMs,
    timeToFirstByteMs: input.responseAtMs === null ? null : Math.max(0, input.responseAtMs - input.startedAtMs),
    transferDurationMs,
    bytes: input.bytes,
    transferMbps: transferDurationMs !== null && transferDurationMs > 0 && input.bytes > 0
      ? applicationMbps(input.bytes, transferDurationMs)
      : null,
    httpStatus: input.response?.status ?? null,
    protocol: protocolFor(input.url),
    cacheControl: input.response?.headers.get("cache-control") ?? null,
    contentEncoding: input.response?.headers.get("content-encoding") ?? null,
    contentLength: headerInteger(input.response?.headers.get("content-length") ?? null),
    serverAcceptedBytes: headerInteger(input.response?.headers.get("cf-meta-upload-bytes") ?? null),
    outcome: input.outcome,
    failureReason: input.failureReason,
  };
}

function randomPayload(bytes: number): ArrayBuffer {
  const output = new Uint8Array(bytes);
  for (let offset = 0; offset < output.length; offset += 65_536) {
    crypto.getRandomValues(output.subarray(offset, Math.min(output.length, offset + 65_536)));
  }
  return output.buffer;
}

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 180) : "Unknown request failure.";
}

async function warmup(plan: CapacityPlan, signal: AbortSignal, callbacks: CapacityCallbacks): Promise<WarmupResult> {
  const url = cacheBust(plan.direction === "download"
    ? downloadUrl(plan.downloadUrlTemplate, plan.warmupBytes)
    : plan.uploadUrl);
  const body = plan.direction === "upload" ? randomPayload(plan.warmupBytes) : null;
  const startedAtMs = performance.now();
  let responseAtMs: number | null = null;
  let firstByteAtMs: number | null = null;
  let response: Response | null = null;
  let bytes = 0;
  try {
    response = await fetch(url, {
      method: plan.direction === "upload" ? "POST" : "GET",
      ...(body ? { body } : {}),
      cache: "no-store",
      signal,
    });
    responseAtMs = performance.now();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    assertUncompressed(response);
    if (plan.direction === "upload") {
      bytes = headerInteger(response.headers.get("cf-meta-upload-bytes")) ?? plan.warmupBytes;
    } else {
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Response body unavailable.");
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (firstByteAtMs === null && chunk.value.byteLength > 0) firstByteAtMs = performance.now();
        bytes += chunk.value.byteLength;
      }
    }
    const endedAtMs = performance.now();
    const item = diagnostic({
      plan, stage: "warmup", stageStreams: 1, streamId: 0, requestId: 0, url, startedAtMs,
      responseAtMs, firstByteAtMs, endedAtMs, bytes, response,
      outcome: "completed", failureReason: null,
    });
    callbacks.onDiagnostic?.(item);
    return {
      bytes,
      durationMs: endedAtMs - startedAtMs,
      transferMbps: item.transferMbps,
      succeeded: bytes > 0,
      diagnostic: item,
    };
  } catch (error) {
    const endedAtMs = performance.now();
    const item = diagnostic({
      plan, stage: "warmup", stageStreams: 1, streamId: 0, requestId: 0, url, startedAtMs,
      responseAtMs, firstByteAtMs, endedAtMs, bytes, response,
      outcome: signal.aborted ? "aborted" : "failed",
      failureReason: signal.aborted ? "Measurement cancelled." : errorText(error),
    });
    callbacks.onDiagnostic?.(item);
    if (signal.aborted) throw error;
    return { bytes: 0, durationMs: endedAtMs - startedAtMs, transferMbps: null, succeeded: false, diagnostic: item };
  }
}

function requestSize(plan: CapacityPlan, previousMbps: number | null, streams: number): number {
  const minimum = plan.direction === "download" ? 2_000_000 : 256_000;
  if (previousMbps === null || previousMbps <= 0) return Math.min(plan.maxRequestBytes, Math.max(minimum, plan.warmupBytes * 4));
  const targetSeconds = plan.direction === "download" ? 1.5 : 0.75;
  const perStreamBytes = previousMbps * 1_000_000 / 8 / Math.max(1, streams) * targetSeconds;
  return Math.round(Math.min(plan.maxRequestBytes, Math.max(minimum, perStreamBytes)));
}

async function latencyProbe(url: string, signal: AbortSignal): Promise<number | null> {
  const started = performance.now();
  try {
    const response = await fetch(cacheBust(url), { cache: "no-store", signal });
    if (!response.ok) return null;
    await response.arrayBuffer();
    return performance.now() - started;
  } catch {
    return null;
  }
}

async function runStage(
  plan: CapacityPlan,
  streams: number,
  stageMaxMs: number,
  requestBytes: number,
  byteBudget: number,
  callbacks: CapacityCallbacks,
  parentSignal: AbortSignal,
): Promise<CapacityStage & { rtts: number[] }> {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parentSignal.reason);
  parentSignal.addEventListener("abort", abortFromParent, { once: true });
  // Random payload generation is client CPU work, not network transfer. Reuse
  // one incompressible body per stage and exclude its creation from the shared
  // measurement window, which matters on lower-power mobile devices.
  const uploadBody = plan.direction === "upload" ? randomPayload(requestBytes) : null;
  const startedAt = performance.now();
  const diagnostics: StreamDiagnostic[] = [];
  const rtts: number[] = [];
  const samples: number[] = [];
  let bytes = 0;
  let windowBytes = 0;
  let lastWindowAt = startedAt;
  let lastProgressAt = startedAt;
  let failedRequests = 0;
  let failedProbes = 0;
  let durationExpired = false;
  let dataCapped = false;
  let reservedUploadBytes = 0;

  const emitProgress = (force = false) => {
    const now = performance.now();
    if (!force && now - lastProgressAt < plan.progressIntervalMs) return;
    lastProgressAt = now;
    const elapsed = now - startedAt;
    if (elapsed > 0) callbacks.onProgress?.(applicationMbps(bytes, elapsed), bytes, streams);
  };
  const countDownload = (amount: number) => {
    bytes += amount;
    windowBytes += amount;
    if (bytes >= byteBudget) {
      dataCapped = true;
      controller.abort("data-cap");
    }
    emitProgress();
  };
  const emitDiagnostic = (item: StreamDiagnostic) => {
    diagnostics.push(item);
    callbacks.onDiagnostic?.(item);
  };

  const sampleTimer = setInterval(() => {
    const now = performance.now();
    const elapsed = now - lastWindowAt;
    if (plan.direction === "download" && elapsed > 0 && windowBytes > 0) {
      samples.push(applicationMbps(windowBytes, elapsed));
    }
    windowBytes = 0;
    lastWindowAt = now;
  }, SAMPLE_INTERVAL_MS);
  const durationTimer = setTimeout(() => {
    durationExpired = true;
    controller.abort("duration");
  }, stageMaxMs);

  const probePromise = (async () => {
    while (!controller.signal.aborted) {
      const rtt = await latencyProbe(plan.latencyUrl, controller.signal);
      if (rtt === null && !controller.signal.aborted) failedProbes += 1;
      else {
        if (rtt !== null) {
          rtts.push(rtt);
          callbacks.onLatency?.(rtt);
        }
      }
      if (controller.signal.aborted) break;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, plan.latencyProbeIntervalMs);
        controller.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      });
    }
  })();

  const workers = Array.from({ length: streams }, (_, streamId) => (async () => {
    let streamRequestId = 0;
    while (!controller.signal.aborted) {
      if (plan.direction === "upload") {
        if (bytes + reservedUploadBytes + requestBytes > byteBudget && bytes > 0) {
          dataCapped = true;
          break;
        }
        reservedUploadBytes += requestBytes;
      }
      const url = cacheBust(plan.direction === "download"
        ? downloadUrl(plan.downloadUrlTemplate, requestBytes)
        : plan.uploadUrl);
      const requestStarted = performance.now();
      let responseAt: number | null = null;
      let firstByteAt: number | null = null;
      let response: Response | null = null;
      let requestTransferred = 0;
      try {
        response = await fetch(url, {
          method: plan.direction === "upload" ? "POST" : "GET",
          ...(uploadBody ? { body: uploadBody } : {}),
          cache: "no-store",
          signal: controller.signal,
        });
        responseAt = performance.now();
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        assertUncompressed(response);
        if (plan.direction === "upload") {
          reservedUploadBytes -= requestBytes;
          const serverAcceptedBytes = headerInteger(response.headers.get("cf-meta-upload-bytes"));
          requestTransferred = serverAcceptedBytes ?? requestBytes;
          bytes += requestTransferred;
          const observationElapsed = performance.now() - startedAt;
          if (observationElapsed > 0) samples.push(applicationMbps(bytes, observationElapsed));
          emitProgress();
          if (bytes >= byteBudget) {
            dataCapped = true;
            controller.abort("data-cap");
          }
        } else {
          const reader = response.body?.getReader();
          if (!reader) throw new Error("Response body unavailable.");
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            if (firstByteAt === null && chunk.value.byteLength > 0) firstByteAt = performance.now();
            requestTransferred += chunk.value.byteLength;
            countDownload(chunk.value.byteLength);
            if (controller.signal.aborted) break;
          }
        }
        emitDiagnostic(diagnostic({
          plan, stage: "measurement", stageStreams: streams, streamId, requestId: streamRequestId, url,
          startedAtMs: requestStarted, responseAtMs: responseAt, firstByteAtMs: firstByteAt,
          endedAtMs: performance.now(), bytes: requestTransferred, response,
          outcome: controller.signal.aborted ? "aborted" : "completed",
          failureReason: controller.signal.aborted ? `Stage stopped: ${String(controller.signal.reason ?? "stop")}.` : null,
        }));
      } catch (error) {
        if (plan.direction === "upload" && reservedUploadBytes >= requestBytes) reservedUploadBytes -= requestBytes;
        if (!controller.signal.aborted) failedRequests += 1;
        emitDiagnostic(diagnostic({
          plan, stage: "measurement", stageStreams: streams, streamId, requestId: streamRequestId, url,
          startedAtMs: requestStarted, responseAtMs: responseAt, firstByteAtMs: firstByteAt,
          endedAtMs: performance.now(), bytes: requestTransferred, response,
          outcome: controller.signal.aborted ? "aborted" : "failed",
          failureReason: controller.signal.aborted
            ? `Stage stopped: ${String(controller.signal.reason ?? "stop")}.`
            : errorText(error),
        }));
        if (!controller.signal.aborted) break;
      } finally {
        streamRequestId += 1;
      }
    }
  })());

  await Promise.allSettled(workers);
  const endedAt = performance.now();
  clearTimeout(durationTimer);
  clearInterval(sampleTimer);
  controller.abort("stage-complete");
  await probePromise;
  parentSignal.removeEventListener("abort", abortFromParent);
  if (parentSignal.aborted) throw parentSignal.reason ?? new DOMException("Aborted", "AbortError");

  const tailElapsed = endedAt - lastWindowAt;
  if (plan.direction === "download" && tailElapsed >= 200 && windowBytes > 0) {
    samples.push(applicationMbps(windowBytes, tailElapsed));
  }
  const durationMs = endedAt - startedAt;
  if (bytes <= 0 || durationMs <= 0) throw new Error(`${plan.direction} capacity stage transferred no usable data.`);
  const aggregateMbps = applicationMbps(bytes, durationMs);
  emitProgress(true);
  const stableSamples = samples.length > 2 ? samples.slice(1) : samples;
  return {
    streams,
    aggregateMbps,
    medianMbps: stableSamples.length ? median(stableSamples) : aggregateMbps,
    p5Mbps: stableSamples.length ? percentile(stableSamples, 5) : aggregateMbps,
    p95Mbps: stableSamples.length ? percentile(stableSamples, 95) : aggregateMbps,
    peakMbps: Math.max(aggregateMbps, max(stableSamples)),
    variationPct: Math.round(coefficientOfVariation(stableSamples) * 1000) / 10,
    samples: stableSamples,
    bytes,
    durationMs,
    requestBytes,
    failedRequests,
    failedProbes,
    improvementPct: null,
    stopReason: dataCapped ? "data-cap" : durationExpired ? "duration" : failedRequests > 0 ? "error" : "completed",
    diagnostics,
    rtts,
  };
}

export function capacityStageBudgetWeights(stageCount: number): number[] {
  if (stageCount <= 0) return [];
  // A gigabit link consumes 450 MB in four seconds. Preserve most of the
  // full-profile budget for the final saturation stage; earlier stages only
  // need enough data to decide whether more concurrency improves throughput.
  if (stageCount === 5) return [0.03, 0.04, 0.18, 0.1, 0.65];
  return Array.from({ length: stageCount }, () => 1 / stageCount);
}

export async function measureCapacity(
  plan: CapacityPlan,
  callbacks: CapacityCallbacks,
  signal: AbortSignal,
): Promise<DirectionCapacity> {
  const startedAt = performance.now();
  callbacks.onStage?.("warmup", 1);
  const warm = await warmup(plan, signal, callbacks);
  const stages: Array<CapacityStage & { rtts: number[] }> = [];
  let consumedBytes = warm.bytes;
  let previousMbps = warm.transferMbps;
  const stageWeights = capacityStageBudgetWeights(plan.streamRamp.length);

  for (let index = 0; index < plan.streamRamp.length; index += 1) {
    if (signal.aborted || consumedBytes >= plan.maxBytes || performance.now() - startedAt >= plan.maxDurationMs) break;
    const streams = plan.streamRamp[index];
    callbacks.onStage?.("measurement", streams);
    const elapsed = performance.now() - startedAt;
    const remainingDuration = Math.max(500, plan.maxDurationMs - elapsed);
    const wantedDuration = index === plan.streamRamp.length - 1 ? plan.finalStageMinMs : plan.stageMaxMs;
    const stageDuration = Math.min(wantedDuration, remainingDuration);
    const remainingBytes = plan.maxBytes - consumedBytes;
    const configuredBudget = Math.floor((plan.maxBytes - warm.bytes) * stageWeights[index]);
    const stageByteBudget = index === plan.streamRamp.length - 1
      ? remainingBytes
      : Math.max(1, Math.min(remainingBytes, configuredBudget));
    const size = requestSize(plan, previousMbps, streams);
    const bytesBeforeStage = consumedBytes;
    const stage = await runStage(plan, streams, stageDuration, size, stageByteBudget, {
      ...callbacks,
      onProgress: (mbps, stageBytes, activeStreams) => callbacks.onProgress?.(
        mbps,
        bytesBeforeStage + stageBytes,
        activeStreams,
      ),
    }, signal);
    const previous = stages.at(-1);
    const improvementPct = previous
      ? (stage.aggregateMbps - previous.aggregateMbps) / Math.max(previous.aggregateMbps, 0.001) * 100
      : null;
    stage.improvementPct = improvementPct;
    stages.push(stage);
    consumedBytes += stage.bytes;
    previousMbps = stage.aggregateMbps;
    const comparableWindows = previous !== undefined
      && previous.durationMs >= plan.stageMinMs
      && stage.durationMs >= plan.stageMinMs;
    if (comparableWindows && improvementPct !== null && improvementPct < plan.improvementThresholdPct) break;
  }

  if (stages.length === 0) throw new Error(`${plan.direction} capacity measurement produced no completed stage.`);
  const qualifiedCapacityStages = stages.filter((stage) => stage.durationMs >= plan.stageMinMs);
  const maximumCandidates = qualifiedCapacityStages.length > 0 ? qualifiedCapacityStages : stages;
  const maximum = maximumCandidates.reduce((best, stage) => stage.aggregateMbps > best.aggregateMbps ? stage : best);
  const single = stages.find((stage) => stage.streams === 1) ?? stages[0];
  const reliableStage = [...stages].reverse().find((stage) => stage.streams <= 4 && stage.samples.length >= 2)
    ?? [...stages].reverse().find((stage) => stage.streams <= 4)
    ?? stages.at(-1)!;
  const reliableSamples = reliableStage.samples.length > 2
    ? reliableStage.samples.slice(Math.floor(reliableStage.samples.length / 2))
    : reliableStage.samples;
  const reliableMbps = reliableSamples.length ? median(reliableSamples) : reliableStage.aggregateMbps;
  const allDiagnostics = [warm.diagnostic, ...stages.flatMap((stage) => stage.diagnostics)];
  const reasons: string[] = [];
  const failedRequests = stages.reduce((sum, stage) => sum + stage.failedRequests, 0);
  const failedProbes = stages.reduce((sum, stage) => sum + stage.failedProbes, 0);
  if (!warm.succeeded) reasons.push("The connection warm-up failed.");
  if (failedRequests > 0) reasons.push(`${failedRequests} transfer request(s) failed.`);
  if (failedProbes > 0) reasons.push(`${failedProbes} loaded-latency probe(s) failed.`);
  if (allDiagnostics.some((item) => item.contentEncoding !== null && item.contentEncoding !== "identity")) {
    reasons.push("A response reported content encoding; application byte accounting may not represent wire bytes.");
  }
  if (allDiagnostics.some((item) =>
    item.direction === "download" &&
    item.outcome === "completed" &&
    item.contentLength !== null &&
    item.contentLength !== item.bytes
  )) {
    reasons.push("A completed download did not match the endpoint Content-Length.");
  }
  if (allDiagnostics.some((item) =>
    item.direction === "upload" &&
    item.outcome === "completed" &&
    item.serverAcceptedBytes !== null &&
    item.serverAcceptedBytes !== item.bytes
  )) {
    reasons.push("An upload receipt did not match the application payload count.");
  }
  if (qualifiedCapacityStages.length === 0) {
    reasons.push("No capacity stage reached the minimum comparison duration; maximum capacity is limited by the configured data cap.");
  }
  if (maximum.streams === plan.streamRamp.at(-1)) {
    reasons.push("Throughput was still best at the maximum permitted stream count; a higher-capacity client profile may be needed.");
  }
  if (maximum.streams > 1) {
    reasons.push("Concurrent Fetch requests target one origin; HTTP/2 or HTTP/3 may multiplex them onto fewer transport connections than the request count.");
  }
  const reliableLimited = reliableSamples.length < 2;
  if (reliableLimited) reasons.push("Reliable throughput had fewer than two stable windows and is labeled limited.");
  return {
    direction: plan.direction,
    maximumMbps: maximum.aggregateMbps,
    reliable: {
      status: reliableLimited ? "limited" : "measured",
      mbps: reliableMbps,
      singleStreamMbps: single.aggregateMbps,
      medianMbps: reliableSamples.length ? median(reliableSamples) : reliableMbps,
      p5Mbps: reliableSamples.length ? percentile(reliableSamples, 5) : reliableMbps,
      p95Mbps: reliableSamples.length ? percentile(reliableSamples, 95) : reliableMbps,
      peakMbps: reliableSamples.length ? max(reliableSamples) : reliableMbps,
      variationPct: Math.round(coefficientOfVariation(reliableSamples) * 1000) / 10,
      samples: reliableSamples,
      sampleCount: reliableSamples.length,
      streams: reliableStage.streams,
      bytes: reliableStage.bytes,
      durationMs: reliableStage.durationMs,
      method: reliableLimited
        ? plan.direction === "download"
          ? "Real shared-window throughput retained because the data cap produced fewer than two stable 500 ms windows."
          : "Real shared-window throughput retained because fewer than two completed upload observations were available."
        : plan.direction === "download"
          ? "Median of the stable half of real 500 ms windows from the highest completed stage using at most four streams."
          : "Median of the stable half of cumulative successfully received upload observations from the highest completed stage using at most four streams.",
      limitation: reliableLimited
        ? plan.direction === "download"
          ? "Fewer than two stable 500 ms windows; use Full mode for a sustained-throughput result."
          : "Fewer than two completed upload observations; use Full mode for a more representative result."
        : null,
    },
    singleStreamMbps: single.aggregateMbps,
    bytes: consumedBytes,
    warmupBytes: warm.bytes,
    durationMs: performance.now() - startedAt,
    selectedStreams: maximum.streams,
    endpoint: plan.endpoint,
    stages,
    diagnostics: allDiagnostics,
    rtts: stages.flatMap((stage) => stage.rtts),
    failedRequests,
    failedProbes,
    warmupSucceeded: warm.succeeded,
    requestCompressionObserved: reasons.some((reason) => reason.startsWith("A response reported")),
    workerUsed: true,
    reducedConfidenceReasons: reasons,
  };
}
