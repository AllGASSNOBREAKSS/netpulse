import { coefficientOfVariation, interquartileMean, max, median, percentile } from "./stats";
import type { CapacityPlan } from "./capacityProtocol";
import type {
  CapacityStage,
  CapacityFailureClassification,
  DirectionCapacity,
  DirectionPublication,
  StageQualification,
  StreamDiagnostic,
  ThroughputPublicationStatus,
  UploadReceiptEvidence,
} from "./types";

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

function measurementUrl(url: string, plan: CapacityPlan, stageId: string): string {
  return `${cacheBust(url)}&np_test_id=${encodeURIComponent(plan.runId)}&np_stage_id=${encodeURIComponent(stageId)}`;
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

function headerText(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 160 ? trimmed : null;
}

function headerBoolean(value: string | null): boolean | null {
  if (value === null) return null;
  if (value.toLowerCase() === "true" || value === "1") return true;
  if (value.toLowerCase() === "false" || value === "0") return false;
  return null;
}

function uploadReceipt(
  plan: CapacityPlan,
  stageId: string,
  attemptedBytes: number,
  response: Response | null,
): UploadReceiptEvidence | null {
  if (plan.direction !== "upload") return null;
  const receivedBytes = headerInteger(response?.headers.get("cf-meta-upload-bytes") ?? null);
  const serverDurationMs = headerInteger(response?.headers.get("x-netpulse-upload-duration-ms") ?? null);
  const receiptId = headerText(response?.headers.get("x-netpulse-receipt-id") ?? null);
  const version = headerText(response?.headers.get("x-netpulse-receipt-version") ?? null);
  const testId = headerText(response?.headers.get("x-netpulse-test-id") ?? null);
  const receiptStageId = headerText(response?.headers.get("x-netpulse-stage-id") ?? null);
  const complete = headerBoolean(response?.headers.get("x-netpulse-receipt-complete") ?? null);
  const disagreementBytes = receivedBytes === null ? null : Math.abs(receivedBytes - attemptedBytes);
  const disagreementPct = disagreementBytes === null || attemptedBytes <= 0
    ? null
    : disagreementBytes / attemptedBytes * 100;
  const toleranceBytes = Math.max(plan.receiptToleranceBytes, attemptedBytes * plan.receiptTolerancePct / 100);
  const reasons: string[] = [];
  if (receivedBytes === null) reasons.push("Server-received byte count was not exposed.");
  if (disagreementBytes !== null && disagreementBytes > toleranceBytes) {
    reasons.push(`Server-received bytes differed from attempted bytes by ${disagreementBytes} bytes (${disagreementPct?.toFixed(3)}%).`);
  }
  if (complete === false) reasons.push("The server marked the upload receipt incomplete.");
  if (testId !== null && testId !== plan.runId) reasons.push("Receipt test ID did not match the active run.");
  if (receiptStageId !== null && receiptStageId !== stageId) reasons.push("Receipt stage ID did not match the active stage.");
  const identityComplete = receiptId !== null && version !== null && testId !== null && receiptStageId !== null && complete === true;
  const identityMismatch = reasons.some((reason) => reason.includes("did not match") || reason.includes("marked") || reason.includes("differed"));
  const status: UploadReceiptEvidence["status"] = identityMismatch
    ? "mismatch"
    : receivedBytes === null
      ? "missing"
      : identityComplete
        ? "verified"
        : "partial";
  if (status === "partial") reasons.push("The endpoint exposed byte receipt evidence without complete versioned receipt identity.");
  return {
    status,
    receiptId,
    version,
    testId,
    stageId: receiptStageId,
    complete,
    attemptedBytes,
    receivedBytes,
    serverDurationMs,
    disagreementBytes,
    disagreementPct,
    reasons,
  };
}

function hasNonIdentityEncoding(item: StreamDiagnostic): boolean {
  return item.contentEncoding !== null && item.contentEncoding.toLowerCase() !== "identity";
}

function downloadPayloadMismatch(item: StreamDiagnostic): boolean {
  if (item.direction !== "download" || item.outcome !== "completed") return false;
  if (hasNonIdentityEncoding(item)) {
    // Fetch exposes decoded application bytes while retaining the response's
    // Content-Encoding header. Content-Length can therefore describe encoded
    // wire bytes and is not comparable. The endpoint request size remains the
    // honest completed-response contract.
    const requestedBytes = item.requestBytes ?? 0;
    return requestedBytes > 0 && item.bytes !== requestedBytes;
  }
  return item.contentLength !== null && item.contentLength !== item.bytes;
}

function protocolFor(url: string): string | null {
  const entries = performance.getEntriesByName?.(url, "resource") as PerformanceResourceTiming[] | undefined;
  return entries?.at(-1)?.nextHopProtocol || null;
}

function diagnostic(input: {
  plan: CapacityPlan;
  stageId: string;
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
  attemptedBytes: number;
  response: Response | null;
  outcome: StreamDiagnostic["outcome"];
  failureReason: string | null;
  measurementWindowStartedAtMs?: number | null;
  measurementWindowEndedAtMs?: number | null;
  requestBytes?: number;
  stageByteBudget?: number;
  abortReason?: string | null;
  failureClassification?: CapacityFailureClassification | null;
}): StreamDiagnostic {
  const transferStart = input.plan.direction === "download"
    ? input.firstByteAtMs
    : input.responseAtMs === null ? null : input.startedAtMs;
  const transferDurationMs = transferStart === null ? null : Math.max(0, input.endedAtMs - transferStart);
  const receipt = uploadReceipt(input.plan, input.stageId, input.attemptedBytes, input.response);
  return {
    runId: input.plan.runId,
    stageId: input.stageId,
    direction: input.plan.direction,
    stage: input.stage,
    stageStreams: input.stageStreams,
    streamId: input.streamId,
    requestId: input.requestId,
    endpoint: canonicalEndpoint(input.url),
    startedAtMs: input.startedAtMs,
    responseAtMs: input.responseAtMs,
    firstByteAtMs: input.firstByteAtMs,
    measurementWindowStartedAtMs: input.measurementWindowStartedAtMs ?? null,
    measurementWindowEndedAtMs: input.measurementWindowEndedAtMs ?? null,
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
    requestBytes: input.requestBytes ?? input.attemptedBytes,
    stageByteBudget: input.stageByteBudget ?? input.plan.maxBytes,
    browserVisibility: typeof document === "undefined"
      ? "unavailable"
      : document.visibilityState === "visible" || document.visibilityState === "hidden" || document.visibilityState === "prerender"
        ? document.visibilityState
        : "unavailable",
    abortReason: input.abortReason ?? null,
    failureClassification: input.failureClassification ?? null,
    clientAttemptedBytes: input.attemptedBytes,
    serverAcceptedBytes: receipt?.receivedBytes ?? null,
    serverReceiveDurationMs: receipt?.serverDurationMs ?? null,
    uploadReceipt: receipt,
    outcome: input.outcome,
    failureReason: input.failureReason,
  };
}

function classifyFailure(
  error: unknown,
  response: Response | null,
  signal: AbortSignal,
  parentSignal: AbortSignal,
): CapacityFailureClassification {
  if (parentSignal.aborted) return "parent-cancellation";
  if (signal.aborted && signal.reason === "setup-timeout") return "endpoint-setup-timeout";
  if (signal.aborted && signal.reason === "duration") return "premature-duration-abort";
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return "browser-interruption";
  if (response !== null && !response.ok) return "endpoint-http-error";
  const message = errorText(error).toLowerCase();
  if (message.includes("response body unavailable")) return "response-body-unavailable";
  if (message.includes("response body empty")) return "response-body-empty";
  if (message.includes("compressed measurement response")) return "compressed-response-rejected";
  if (error instanceof TypeError) return "cors-or-network-fetch-failure";
  return "unknown-endpoint-failure";
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
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abortFromParent, { once: true });
  const setupTimer = setTimeout(() => controller.abort("setup-timeout"), plan.setupTimeoutMs);
  const stageId = `${plan.direction}-warmup`;
  const url = measurementUrl(plan.direction === "download"
    ? downloadUrl(plan.downloadUrlTemplate, plan.warmupBytes)
    : plan.uploadUrl, plan, stageId);
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
      signal: controller.signal,
    });
    responseAtMs = performance.now();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
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
    clearTimeout(setupTimer);
    signal.removeEventListener("abort", abortFromParent);
    const item = diagnostic({
      plan, stageId, stage: "warmup", stageStreams: 1, streamId: 0, requestId: 0, url, startedAtMs,
      responseAtMs, firstByteAtMs, endedAtMs, bytes, response,
      attemptedBytes: plan.direction === "upload" ? plan.warmupBytes : 0,
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
    clearTimeout(setupTimer);
    signal.removeEventListener("abort", abortFromParent);
    const item = diagnostic({
      plan, stageId, stage: "warmup", stageStreams: 1, streamId: 0, requestId: 0, url, startedAtMs,
      responseAtMs, firstByteAtMs, endedAtMs, bytes, response,
      attemptedBytes: plan.direction === "upload" ? plan.warmupBytes : 0,
      outcome: controller.signal.aborted ? "aborted" : "failed",
      failureReason: signal.aborted
        ? "Measurement cancelled."
        : controller.signal.reason === "setup-timeout"
          ? "Warm-up stopped: setup-timeout."
          : errorText(error),
      abortReason: controller.signal.aborted ? String(controller.signal.reason ?? "stop") : null,
      failureClassification: classifyFailure(error, response, controller.signal, signal),
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

export async function runCapacityStage(
  plan: CapacityPlan,
  stageId: string,
  streams: number,
  stageMaxMs: number,
  requiredMinMs: number,
  requestBytes: number,
  byteBudget: number,
  callbacks: CapacityCallbacks,
  parentSignal: AbortSignal,
  retryAttempt: 0 | 1 = 0,
  configuredStreams = streams,
): Promise<CapacityStage & { rtts: number[] }> {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parentSignal.reason);
  parentSignal.addEventListener("abort", abortFromParent, { once: true });
  // Random payload generation is client CPU work, not network transfer. Reuse
  // one incompressible body per stage and exclude its creation from the shared
  // measurement window, which matters on lower-power mobile devices.
  const uploadBody = plan.direction === "upload" ? randomPayload(requestBytes) : null;
  const wallClockStartedAt = performance.now();
  const diagnostics: StreamDiagnostic[] = [];
  const rtts: number[] = [];
  const samples: number[] = [];
  let firstRequestStartedAt: number | null = null;
  let firstResponseAt: number | null = null;
  let firstPayloadAt: number | null = null;
  let measurementStartedAt: number | null = null;
  let bytes = 0;
  let windowBytes = 0;
  let lastWindowAt: number | null = null;
  let lastProgressAt = wallClockStartedAt;
  let failedRequests = 0;
  let failedProbes = 0;
  let durationExpired = false;
  let setupExpired = false;
  let dataCapped = false;
  let statisticallyStable = false;
  let reservedUploadBytes = 0;
  let sampleTimer: ReturnType<typeof setInterval> | null = null;
  let durationTimer: ReturnType<typeof setTimeout> | null = null;

  const setupTimer = setTimeout(() => {
    if (measurementStartedAt === null) {
      setupExpired = true;
      controller.abort("setup-timeout");
    }
  }, plan.setupTimeoutMs);

  const emitProgress = (force = false) => {
    if (measurementStartedAt === null) return;
    const now = performance.now();
    if (!force && now - lastProgressAt < plan.progressIntervalMs) return;
    lastProgressAt = now;
    const elapsed = now - measurementStartedAt;
    if (elapsed > 0) callbacks.onProgress?.(applicationMbps(bytes, elapsed), bytes, streams);
  };
  const maybeStopStatistically = (now: number) => {
    if (
      measurementStartedAt !== null &&
      plan.allowEarlyStatisticalStop &&
      now - measurementStartedAt >= requiredMinMs &&
      bytes >= plan.stageMinBytes &&
      samples.length >= plan.minValidSamples &&
      coefficientOfVariation(samples) * 100 <= plan.maxVariationPct
    ) {
      statisticallyStable = true;
      controller.abort("stable");
    }
  };
  const startMeasurement = (at: number) => {
    if (measurementStartedAt !== null) return;
    measurementStartedAt = at;
    firstPayloadAt = at;
    lastWindowAt = at;
    lastProgressAt = at;
    clearTimeout(setupTimer);
    sampleTimer = setInterval(() => {
      const now = performance.now();
      if (lastWindowAt === null) return;
      const elapsed = now - lastWindowAt;
      if (plan.direction === "download" && elapsed > 0 && windowBytes > 0) {
        samples.push(applicationMbps(windowBytes, elapsed));
      }
      windowBytes = 0;
      lastWindowAt = now;
      maybeStopStatistically(now);
    }, SAMPLE_INTERVAL_MS);
    durationTimer = setTimeout(() => {
      durationExpired = true;
      controller.abort("duration");
    }, stageMaxMs);
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
      const url = measurementUrl(plan.direction === "download"
        ? downloadUrl(plan.downloadUrlTemplate, requestBytes)
        : plan.uploadUrl, plan, stageId);
      const requestStarted = performance.now();
      firstRequestStartedAt ??= requestStarted;
      if (plan.direction === "upload") startMeasurement(requestStarted);
      let responseAt: number | null = null;
      let firstByteAt: number | null = null;
      let response: Response | null = null;
      let requestTransferred = 0;
      let requestCompleted: boolean;
      try {
        response = await fetch(url, {
          method: plan.direction === "upload" ? "POST" : "GET",
          ...(uploadBody ? { body: uploadBody } : {}),
          cache: "no-store",
          signal: controller.signal,
        });
        responseAt = performance.now();
        firstResponseAt = firstResponseAt === null ? responseAt : Math.min(firstResponseAt, responseAt);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (plan.direction === "upload") {
          reservedUploadBytes -= requestBytes;
          const serverAcceptedBytes = headerInteger(response.headers.get("cf-meta-upload-bytes"));
          requestTransferred = serverAcceptedBytes ?? requestBytes;
          bytes += requestTransferred;
          const receiptDuration = headerInteger(response.headers.get("x-netpulse-upload-duration-ms"));
          const observationElapsed = receiptDuration ?? performance.now() - requestStarted;
          if (observationElapsed > 0) samples.push(applicationMbps(requestTransferred, observationElapsed));
          emitProgress();
          requestCompleted = true;
          maybeStopStatistically(performance.now());
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
            if (firstByteAt === null && chunk.value.byteLength > 0) {
              firstByteAt = performance.now();
              startMeasurement(firstByteAt);
            }
            requestTransferred += chunk.value.byteLength;
            countDownload(chunk.value.byteLength);
            if (controller.signal.aborted) break;
          }
          if (requestTransferred === 0 && !controller.signal.aborted) throw new Error("Response body empty.");
          requestCompleted = !controller.signal.aborted;
        }
        emitDiagnostic(diagnostic({
          plan, stageId, stage: "measurement", stageStreams: streams, streamId, requestId: streamRequestId, url,
          startedAtMs: requestStarted, responseAtMs: responseAt, firstByteAtMs: firstByteAt,
          endedAtMs: performance.now(), bytes: requestTransferred, attemptedBytes: plan.direction === "upload" ? requestBytes : 0, response,
          outcome: requestCompleted ? "completed" : "aborted",
          failureReason: requestCompleted ? null : `Stage stopped: ${String(controller.signal.reason ?? "stop")}.`,
          measurementWindowStartedAtMs: measurementStartedAt,
          measurementWindowEndedAtMs: measurementStartedAt === null ? null : performance.now(),
          requestBytes,
          stageByteBudget: byteBudget,
          abortReason: requestCompleted ? null : String(controller.signal.reason ?? "stop"),
          failureClassification: controller.signal.reason === "setup-timeout" ? "endpoint-setup-timeout" : null,
        }));
      } catch (error) {
        if (plan.direction === "upload" && reservedUploadBytes >= requestBytes) reservedUploadBytes -= requestBytes;
        if (!controller.signal.aborted) failedRequests += 1;
        emitDiagnostic(diagnostic({
          plan, stageId, stage: "measurement", stageStreams: streams, streamId, requestId: streamRequestId, url,
          startedAtMs: requestStarted, responseAtMs: responseAt, firstByteAtMs: firstByteAt,
          endedAtMs: performance.now(), bytes: requestTransferred, attemptedBytes: plan.direction === "upload" ? requestBytes : 0, response,
          outcome: controller.signal.aborted ? "aborted" : "failed",
          failureReason: controller.signal.aborted
            ? `Stage stopped: ${String(controller.signal.reason ?? "stop")}.`
            : errorText(error),
          measurementWindowStartedAtMs: measurementStartedAt,
          measurementWindowEndedAtMs: measurementStartedAt === null ? null : performance.now(),
          requestBytes,
          stageByteBudget: byteBudget,
          abortReason: controller.signal.aborted ? String(controller.signal.reason ?? "stop") : null,
          failureClassification: classifyFailure(error, response, controller.signal, parentSignal),
        }));
        if (!controller.signal.aborted) break;
      } finally {
        streamRequestId += 1;
      }
    }
  })());

  await Promise.allSettled(workers);
  const endedAt = performance.now();
  clearTimeout(setupTimer);
  if (durationTimer !== null) clearTimeout(durationTimer);
  if (sampleTimer !== null) clearInterval(sampleTimer);
  controller.abort("stage-complete");
  await probePromise;
  parentSignal.removeEventListener("abort", abortFromParent);
  if (parentSignal.aborted) throw parentSignal.reason ?? new DOMException("Aborted", "AbortError");

  const measurementEndedAt = measurementStartedAt === null ? null : endedAt;
  const tailElapsed = lastWindowAt === null ? 0 : endedAt - lastWindowAt;
  if (plan.direction === "download" && tailElapsed >= 200 && windowBytes > 0) {
    samples.push(applicationMbps(windowBytes, tailElapsed));
  }
  const durationMs = measurementStartedAt === null ? 0 : endedAt - measurementStartedAt;
  const aggregateMbps = bytes > 0 && durationMs > 0 ? applicationMbps(bytes, durationMs) : 0;
  emitProgress(true);
  const stableSamples = samples.length > 2 ? samples.slice(1) : samples;
  const variation = coefficientOfVariation(stableSamples);
  const provisional: CapacityStage = {
    stageId,
    streams,
    configuredStreams,
    retryAttempt,
    recoveredFromFailure: retryAttempt === 1 && bytes > 0,
    recoveryReason: null,
    wallClockStartedAtMs: wallClockStartedAt,
    firstRequestStartedAtMs: firstRequestStartedAt,
    firstResponseAtMs: firstResponseAt,
    firstPayloadAtMs: firstPayloadAt,
    measurementStartedAtMs: measurementStartedAt,
    measurementEndedAtMs: measurementEndedAt,
    wallClockDurationMs: endedAt - wallClockStartedAt,
    stageByteBudget: byteBudget,
    aggregateMbps,
    medianMbps: stableSamples.length ? median(stableSamples) : aggregateMbps,
    trimmedMeanMbps: stableSamples.length ? interquartileMean(stableSamples) : aggregateMbps,
    p5Mbps: stableSamples.length ? percentile(stableSamples, 5) : aggregateMbps,
    p50Mbps: stableSamples.length ? percentile(stableSamples, 50) : aggregateMbps,
    p95Mbps: stableSamples.length ? percentile(stableSamples, 95) : aggregateMbps,
    peakMbps: stableSamples.length > 0 ? Math.max(aggregateMbps, max(stableSamples)) : aggregateMbps,
    variationPct: Math.round(variation * 1000) / 10,
    coefficientOfVariation: variation,
    samples: stableSamples,
    validWindowCount: stableSamples.length,
    bytes,
    durationMs,
    requestBytes,
    requestCount: diagnostics.length,
    completedRequests: diagnostics.filter((item) => item.outcome === "completed").length,
    failedRequests,
    failedProbes,
    improvementPct: null,
    stopReason: setupExpired
      ? "setup-timeout"
      : statisticallyStable
        ? "stable"
        : dataCapped
          ? "data-cap"
          : durationExpired
            ? "duration"
            : failedRequests > 0 || bytes <= 0
              ? "error"
              : "completed",
    rampState: "ramping",
    endpointHealth: plan.endpointHealth,
    qualification: emptyQualification(),
    diagnostics,
  };
  provisional.qualification = qualifyCapacityStage(provisional, plan.direction, qualificationRequirements(plan, requiredMinMs));
  return { ...provisional, rtts };
}

async function runStageWithRecovery(
  plan: CapacityPlan,
  stageId: string,
  streams: number,
  stageMaxMs: number,
  requiredMinMs: number,
  requestBytes: number,
  byteBudget: number,
  callbacks: CapacityCallbacks,
  parentSignal: AbortSignal,
): Promise<CapacityStage & { rtts: number[] }> {
  const first = await runCapacityStage(
    plan,
    stageId,
    streams,
    stageMaxMs,
    requiredMinMs,
    requestBytes,
    byteBudget,
    callbacks,
    parentSignal,
    0,
    streams,
  );
  if (first.bytes > 0 || parentSignal.aborted) return first;

  const reason = first.diagnostics.find((item) => item.failureClassification)?.failureClassification
    ?? (first.stopReason === "setup-timeout" ? "endpoint-setup-timeout" : "response-body-empty");
  const retryStreams = Math.max(1, Math.floor(streams / 2));
  // Recovery must favor prompt first-byte evidence over large individual
  // transfers. A half-size retry can still be 64 MB in the full profile,
  // which is enough to trigger buffering or memory pressure in mobile
  // browsers before JavaScript receives the first chunk.
  const recoveryRequestCeiling = plan.direction === "download" ? 8_000_000 : 1_500_000;
  const retryBytes = Math.max(
    1,
    Math.min(Math.floor(requestBytes / 2), recoveryRequestCeiling, byteBudget),
  );
  const retry = await runCapacityStage(
    plan,
    `${stageId}-retry`,
    retryStreams,
    stageMaxMs,
    requiredMinMs,
    retryBytes,
    byteBudget,
    callbacks,
    parentSignal,
    1,
    streams,
  );
  retry.diagnostics = [...first.diagnostics, ...retry.diagnostics];
  retry.requestCount = (first.requestCount ?? first.diagnostics.length) + (retry.requestCount ?? retry.diagnostics.length);
  retry.completedRequests = (first.completedRequests ?? 0) + (retry.completedRequests ?? 0);
  retry.failedRequests += first.failedRequests;
  retry.failedProbes += first.failedProbes;
  retry.recoveredFromFailure = retry.bytes > 0;
  retry.recoveryReason = reason;
  return retry;
}

export type StageQualificationRequirements = {
  minDurationMs: number;
  minBytes: number;
  minValidSamples: number;
  maxVariationPct: number;
};

function qualificationRequirements(plan: CapacityPlan, minDurationMs: number): StageQualificationRequirements {
  return {
    minDurationMs,
    minBytes: plan.stageMinBytes,
    minValidSamples: plan.minValidSamples,
    maxVariationPct: plan.maxVariationPct,
  };
}

function emptyQualification(): StageQualification {
  return {
    status: "rejected",
    durationQualified: false,
    bytesQualified: false,
    samplesQualified: false,
    variationQualified: false,
    endpointQualified: false,
    completionQualified: false,
    receiptQualified: false,
    cacheQualified: false,
    compressionQualified: false,
    reasons: ["Stage qualification has not been evaluated."],
  };
}

export function qualifyCapacityStage(
  stage: CapacityStage,
  direction: "download" | "upload",
  requirements: StageQualificationRequirements,
): StageQualification {
  const reasons: string[] = [];
  const durationQualified = stage.durationMs >= requirements.minDurationMs;
  const bytesQualified = stage.bytes >= requirements.minBytes;
  const samplesQualified = stage.validWindowCount >= requirements.minValidSamples;
  const variationQualified = Number.isFinite(stage.variationPct) && stage.variationPct <= requirements.maxVariationPct;
  const endpointQualified = stage.endpointHealth === "healthy";
  const completedDiagnostics = stage.diagnostics.filter((item) => item.outcome === "completed");
  const responseDiagnostics = stage.diagnostics.filter((item) => item.httpStatus !== null && item.outcome !== "failed");
  const intentionallyStopped = stage.diagnostics.some((item) =>
    item.outcome === "aborted" && /^Stage stopped: (?:data-cap|duration|stable)\./.test(item.failureReason ?? "")
  );
  const completionQualified = stage.stopReason !== "error"
    && (stage.failedRequests === 0 || stage.recoveredFromFailure === true)
    && (completedDiagnostics.length > 0 || intentionallyStopped);
  // Content coding on the small upload acknowledgement does not alter the
  // request-body byte accounting. For downloads, Fetch returns decoded bytes,
  // so encoded evidence remains usable only as an estimate and never as a
  // fully qualified wire-capacity measurement.
  const compressionQualified = direction === "upload" || (
    responseDiagnostics.length > 0 && responseDiagnostics.every((item) => !hasNonIdentityEncoding(item))
  );
  const cacheQualified = responseDiagnostics.length > 0 && responseDiagnostics.every((item) => {
    const value = item.cacheControl?.toLowerCase() ?? "";
    return value.includes("no-store") || value.includes("no-cache");
  });
  const receiptIds = completedDiagnostics.flatMap((item) => item.uploadReceipt?.receiptId ? [item.uploadReceipt.receiptId] : []);
  const duplicateReceipt = new Set(receiptIds).size !== receiptIds.length;
  const receiptQualified = direction === "download" || (
    !duplicateReceipt &&
    completedDiagnostics.every((item) =>
      item.uploadReceipt !== null &&
      (item.uploadReceipt.status === "verified" || item.uploadReceipt.status === "partial")
    )
  );
  const receiptMismatch = direction === "upload" && completedDiagnostics.some((item) =>
    item.uploadReceipt?.status === "mismatch" || item.uploadReceipt?.status === "invalid"
  );
  const contentMismatch = direction === "download" && completedDiagnostics.some(downloadPayloadMismatch);
  const finite = Number.isFinite(stage.aggregateMbps) && stage.aggregateMbps > 0 && stage.bytes > 0 && stage.durationMs > 0;

  if (!durationQualified) reasons.push(`Duration ${Math.round(stage.durationMs)} ms was below the ${requirements.minDurationMs} ms minimum.`);
  if (!bytesQualified) reasons.push(`Payload ${stage.bytes} bytes was below the ${requirements.minBytes} byte minimum.`);
  if (!samplesQualified) reasons.push(`Only ${stage.validWindowCount} valid sample(s) were available; ${requirements.minValidSamples} required.`);
  if (!variationQualified) reasons.push(`Variation ${stage.variationPct.toFixed(1)}% exceeded the ${requirements.maxVariationPct}% limit.`);
  if (!endpointQualified) reasons.push(`Endpoint health was ${stage.endpointHealth}, not healthy.`);
  if (!completionQualified) reasons.push("The stage did not complete without transfer failures.");
  if (stage.recoveredFromFailure) reasons.push("The stage recovered after one classified zero-byte attempt.");
  if (!compressionQualified) {
    reasons.push("A completed download used content encoding; decoded application bytes are retained only as estimate evidence.");
  }
  if (!cacheQualified) reasons.push("No-store/no-cache response evidence was incomplete.");
  if (!receiptQualified && direction === "upload") reasons.push("Upload receipt evidence was missing, duplicated, or incomplete.");
  if (duplicateReceipt) reasons.push("A duplicate upload receipt ID was observed.");
  if (receiptMismatch) reasons.push("Upload receipt identity or byte accounting disagreed with the request.");
  if (contentMismatch) reasons.push("Completed download bytes did not match Content-Length.");
  if (!finite) reasons.push("Stage has no finite positive aggregate measurement.");

  const hardRejected = !finite || !completionQualified || receiptMismatch || contentMismatch || duplicateReceipt;
  const fullyQualified = durationQualified && bytesQualified && samplesQualified && variationQualified
    && endpointQualified && completionQualified && receiptQualified && cacheQualified && compressionQualified;
  return {
    status: hardRejected ? "rejected" : fullyQualified ? "qualified" : "estimate-only",
    durationQualified,
    bytesQualified,
    samplesQualified,
    variationQualified,
    endpointQualified,
    completionQualified,
    receiptQualified,
    cacheQualified,
    compressionQualified,
    reasons: unique(reasons),
  };
}

export function capacityStageBudgetWeights(
  stageCount: number,
  profileMode: CapacityPlan["profileMode"] = "full",
): number[] {
  if (stageCount <= 0) return [];
  // A gigabit link consumes 450 MB in four seconds. Preserve most of the
  // full-profile budget for the final saturation stage; earlier stages only
  // need enough data to decide whether more concurrency improves throughput.
  if (stageCount === 5) return [0.03, 0.04, 0.18, 0.1, 0.65];
  if (stageCount === 3 && profileMode === "full") return [0.15, 0.25, 0.6];
  if (stageCount === 2 && profileMode === "lowData") return [0.25, 0.75];
  if (stageCount === 2 && profileMode === "quick") return [0.35, 0.65];
  return Array.from({ length: stageCount }, () => 1 / stageCount);
}

type CapacitySelection = {
  maximum: CapacityStage;
  single: CapacityStage;
  reliableStage: CapacityStage;
  reliableRates: number[];
  publication: DirectionPublication;
  excludedReasons: string[];
};

/**
 * Selects all published throughput products from the same evidence basis:
 * qualified fixed-window statistics from one receipt-consistent stage pool.
 * This prevents cumulative completion or short-stage values from being
 * compared with an unrelated maximum.
 */
export function selectComparableCapacity(
  stages: CapacityStage[],
  direction: "download" | "upload",
  stageMinMs: number,
  finalStageMinMs: number,
  expectedStageCount: number,
  qualificationOverrides: Partial<Omit<StageQualificationRequirements, "minDurationMs">> = {},
): CapacitySelection {
  if (stages.length === 0) throw new Error("Capacity selection requires at least one stage.");
  const evaluatedStages = stages.map((stage) => {
    const qualification = qualifyCapacityStage(stage, direction, {
      minDurationMs: stageMinMs,
      minBytes: qualificationOverrides.minBytes ?? 1,
      minValidSamples: qualificationOverrides.minValidSamples ?? 1,
      maxVariationPct: qualificationOverrides.maxVariationPct ?? 100,
    });
    return { ...stage, qualification };
  });
  const evidence = evaluatedStages.map((stage) => ({
    stage,
    reasons: stage.qualification.status === "rejected" ? stage.qualification.reasons : [],
  }));
  const validStages = evidence.filter((item) => item.reasons.length === 0).map((item) => item.stage);
  const qualifiedStages = validStages.filter((stage) => stage.qualification.status === "qualified");
  const comparableStages = qualifiedStages.length > 0 ? qualifiedStages : validStages;
  const rawMaximum = evaluatedStages.reduce((best, stage) => capacityValue(stage) > capacityValue(best) ? stage : best);
  const maximum = comparableStages.length > 0
    ? comparableStages.reduce((best, stage) => capacityValue(stage) > capacityValue(best) ? stage : best)
    : rawMaximum;
  const comparableSingle = comparableStages.filter((stage) => stage.streams === 1);
  const rawSingle = evaluatedStages.find((stage) => stage.streams === 1) ?? evaluatedStages[0];
  const single = comparableSingle.length > 0
    ? comparableSingle.reduce((best, stage) => capacityValue(stage) > capacityValue(best) ? stage : best)
    : rawSingle;
  const reliableStages = comparableStages.filter((stage) => stage.streams <= 4);
  const reliableStage = reliableStages.length > 0
    ? reliableStages.reduce((best, stage) => capacityValue(stage) > capacityValue(best) ? stage : best)
    : maximum;
  const reliableRates = reliableStage.samples;
  const exhaustedBeforeRampCompleted = evaluatedStages.some((stage) => stage.stopReason === "data-cap")
    && evaluatedStages.length < expectedStageCount;
  const maximumStatus = publicationStatus({
    hasValidEvidence: validStages.length > 0,
    qualified: maximum.qualification.status === "qualified",
    stage: maximum,
    finalStageMinMs,
    exhaustedBeforeRampCompleted,
  });
  let singleStatus: ThroughputPublicationStatus = comparableSingle.length === 0
    ? "inconclusive"
    : publicationStatus({
        hasValidEvidence: true,
        qualified: single.qualification.status === "qualified",
        stage: single,
        finalStageMinMs: stageMinMs,
        exhaustedBeforeRampCompleted: false,
      });
  let reliableStatus: ThroughputPublicationStatus = reliableRates.length === 0
    ? "inconclusive"
    : reliableStage.qualification.status === "qualified" && !exhaustedBeforeRampCompleted
      ? "measured"
      : "quick-estimate";
  const maximumValue = capacityValue(maximum);
  const singleValue = capacityValue(single);
  const reliableValue = reliableRates.length > 0 ? percentile(reliableRates, 25) : null;
  if (reliableValue !== null && reliableValue > maximumValue) reliableStatus = "inconclusive";
  if (comparableSingle.length > 0 && singleValue > maximumValue) singleStatus = "inconclusive";
  const excludedReasons = evidence.flatMap((item, index) =>
    item.reasons.map((reason) => `Stage ${index + 1} (${item.stage.streams} stream): ${reason}`)
  );

  return {
    maximum,
    single,
    reliableStage,
    reliableRates: reliableRates.length > 0 ? reliableRates : [reliableStage.aggregateMbps],
    publication: {
      maximum: {
        status: maximumStatus,
        valueMbps: maximumStatus === "inconclusive" ? null : maximumValue,
        reasons: publicationReasons(maximumStatus, maximum, excludedReasons, exhaustedBeforeRampCompleted),
      },
      reliable: {
        status: reliableStatus,
        valueMbps: reliableStatus === "inconclusive" ? null : reliableValue,
        reasons: reliablePublicationReasons(
          reliableStatus,
          reliableRates.length,
          excludedReasons,
          reliableValue !== null && reliableValue > maximumValue,
        ),
      },
      singleStream: {
        status: singleStatus,
        valueMbps: singleStatus === "inconclusive" ? null : singleValue,
        reasons: singlePublicationReasons(
          singleStatus,
          excludedReasons,
          comparableSingle.length > 0 && singleValue > maximumValue,
        ),
      },
      comparisonBasis: "Maximum and single-stream use fixed-window P50 from the same qualified stage pool; reliable throughput uses P25 of stable windows from the best qualified stage using no more than four requests.",
      excludedStageCount: evaluatedStages.length - validStages.length,
      semanticConsistency: {
        valid: reliableStatus !== "inconclusive" && singleStatus !== "inconclusive",
        reasons: unique([
          ...(reliableValue !== null && reliableValue > maximumValue
            ? ["Reliable throughput exceeded maximum after qualified-window recalculation."]
            : []),
          ...(comparableSingle.length > 0 && singleValue > maximumValue
            ? ["Single-stream throughput exceeded maximum after qualified-window recalculation."]
            : []),
        ]),
      },
    },
    excludedReasons,
  };
}

function capacityValue(stage: CapacityStage): number {
  return stage.samples.length > 0 ? stage.p50Mbps : stage.aggregateMbps;
}

function publicationStatus(input: {
  hasValidEvidence: boolean;
  qualified: boolean;
  stage: CapacityStage;
  finalStageMinMs: number;
  exhaustedBeforeRampCompleted: boolean;
}): ThroughputPublicationStatus {
  if (!input.hasValidEvidence) return "inconclusive";
  if (
    !input.qualified ||
    input.exhaustedBeforeRampCompleted ||
    input.stage.stopReason === "data-cap" && input.stage.durationMs < input.finalStageMinMs
  ) {
    return "quick-estimate";
  }
  return "measured";
}

function publicationReasons(
  status: ThroughputPublicationStatus,
  stage: CapacityStage,
  excludedReasons: string[],
  exhaustedBeforeRampCompleted: boolean,
): string[] {
  const reasons = [...excludedReasons];
  if (status === "quick-estimate") {
    if (stage.stopReason === "data-cap" || exhaustedBeforeRampCompleted) {
      reasons.push("The configured data budget ended the capacity ramp before full comparable evidence was collected.");
    }
    reasons.push("The selected capacity evidence did not satisfy the full publication duration and ramp requirements.");
  }
  if (status === "inconclusive") reasons.push("No receipt-consistent capacity stage was publishable.");
  return unique(reasons);
}

function reliablePublicationReasons(
  status: ThroughputPublicationStatus,
  sampleCount: number,
  excludedReasons: string[],
  inconsistent: boolean,
): string[] {
  const reasons = [...excludedReasons];
  if (status === "quick-estimate") {
    reasons.push(`Reliable throughput has ${sampleCount} stable window sample(s), but the stage or completed ramp did not satisfy every qualification requirement.`);
  }
  if (status === "inconclusive") {
    reasons.push(inconsistent
      ? "Reliable throughput exceeded maximum capacity after comparable-stage calculation; the metric was withheld as inconclusive."
      : "No comparable qualified stage aggregate was available for reliable throughput.");
  }
  return unique(reasons);
}

function singlePublicationReasons(
  status: ThroughputPublicationStatus,
  excludedReasons: string[],
  inconsistent: boolean,
): string[] {
  const reasons = [...excludedReasons];
  if (status === "quick-estimate") reasons.push("The single-stream stage did not satisfy the full publication duration requirement.");
  if (status === "inconclusive") {
    reasons.push(inconsistent
      ? "Single-stream throughput exceeded maximum capacity after comparable-stage calculation; the metric was withheld as inconclusive."
      : "No receipt-consistent single-stream stage was publishable.");
  }
  return unique(reasons);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
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
  let measuredDurationMs = 0;
  let previousMbps = warm.transferMbps;
  const stageWeights = capacityStageBudgetWeights(plan.streamRamp.length, plan.profileMode);

  for (let index = 0; index < plan.streamRamp.length; index += 1) {
    if (signal.aborted || consumedBytes >= plan.maxBytes || measuredDurationMs >= plan.maxDurationMs) break;
    const streams = plan.streamRamp[index];
    const stageId = `${plan.direction}-${index + 1}-${streams}s`;
    callbacks.onStage?.("measurement", streams);
    const remainingDuration = Math.max(500, plan.maxDurationMs - measuredDurationMs);
    const wantedDuration = index === plan.streamRamp.length - 1 ? plan.finalStageMinMs : plan.stageMaxMs;
    const requiredMinMs = index === plan.streamRamp.length - 1 ? plan.finalStageMinMs : plan.stageMinMs;
    const stageDuration = Math.min(wantedDuration, remainingDuration);
    const remainingBytes = plan.maxBytes - consumedBytes;
    const configuredBudget = Math.floor((plan.maxBytes - warm.bytes) * stageWeights[index]);
    const stageByteBudget = index === plan.streamRamp.length - 1
      ? remainingBytes
      : Math.max(1, Math.min(remainingBytes, configuredBudget));
    const size = requestSize(plan, previousMbps, streams);
    const bytesBeforeStage = consumedBytes;
    const stage = await runStageWithRecovery(plan, stageId, streams, stageDuration, requiredMinMs, size, stageByteBudget, {
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
    stage.rampState = index === 0
      ? "baseline"
      : improvementPct !== null && improvementPct < plan.improvementThresholdPct
        ? "saturation"
        : index === plan.streamRamp.length - 1
          ? "ceiling"
          : "ramping";
    stages.push(stage);
    consumedBytes += stage.bytes;
    measuredDurationMs += stage.durationMs;
    if (stage.bytes <= 0) break;
    previousMbps = stage.aggregateMbps;
    const comparableWindows = previous !== undefined
      && previous.durationMs >= plan.stageMinMs
      && stage.durationMs >= plan.stageMinMs;
    if (comparableWindows && improvementPct !== null && improvementPct < plan.improvementThresholdPct) {
      const remainingBytesAfterStage = plan.maxBytes - consumedBytes;
      const remainingMsAfterStage = plan.maxDurationMs - measuredDurationMs;
      if (
        stage.durationMs < plan.finalStageMinMs &&
        remainingBytesAfterStage > 0 &&
        remainingMsAfterStage >= plan.stageMinMs
      ) {
        const confirmationId = `${stageId}-confirmation`;
        callbacks.onStage?.("measurement", streams);
        const confirmationDuration = Math.min(plan.finalStageMinMs, remainingMsAfterStage);
        const confirmationSize = requestSize(plan, stage.aggregateMbps, streams);
        const bytesBeforeConfirmation = consumedBytes;
        const confirmation = await runStageWithRecovery(
          plan,
          confirmationId,
          streams,
          confirmationDuration,
          plan.finalStageMinMs,
          confirmationSize,
          remainingBytesAfterStage,
          {
            ...callbacks,
            onProgress: (mbps, stageBytes, activeStreams) => callbacks.onProgress?.(
              mbps,
              bytesBeforeConfirmation + stageBytes,
              activeStreams,
            ),
          },
          signal,
        );
        confirmation.improvementPct = (
          confirmation.p50Mbps - stage.p50Mbps
        ) / Math.max(stage.p50Mbps, 0.001) * 100;
        confirmation.rampState = "saturation";
        stages.push(confirmation);
        consumedBytes += confirmation.bytes;
      }
      break;
    }
  }

  if (stages.length === 0) throw new Error(`${plan.direction} capacity measurement produced no completed stage.`);
  const selection = selectComparableCapacity(
    stages,
    plan.direction,
    plan.stageMinMs,
    plan.finalStageMinMs,
    plan.streamRamp.length,
    {
      minBytes: plan.stageMinBytes,
      minValidSamples: plan.minValidSamples,
      maxVariationPct: plan.maxVariationPct,
    },
  );
  const { maximum, single, reliableStage, publication } = selection;
  const reliableSamples = selection.reliableRates;
  const reliableMbps = publication.reliable.valueMbps ?? percentile(reliableSamples, 25);
  const maximumMbps = publication.maximum.valueMbps ?? capacityValue(maximum);
  const singleStreamMbps = publication.singleStream.valueMbps ?? capacityValue(single);
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
  if (allDiagnostics.some(downloadPayloadMismatch)) {
    reasons.push("A completed download did not match the endpoint's requested payload size or unencoded Content-Length.");
  }
  if (selection.excludedReasons.some((reason) => reason.includes("upload receipt"))) {
    reasons.push("An upload receipt did not match the application payload count.");
  }
  if (publication.maximum.status !== "measured") {
    reasons.push("Maximum capacity did not satisfy the full publication duration and data requirements.");
  }
  if (stages.some((stage) => stage.stageId.endsWith("-confirmation"))) {
    reasons.push("The apparent saturation stage was repeated with the final-stage duration requirement before publication.");
  }
  if (maximum.streams === plan.streamRamp.at(-1)) {
    reasons.push("Throughput was still best at the maximum permitted stream count; a higher-capacity client profile may be needed.");
  }
  if (maximum.streams > 1) {
    reasons.push("Concurrent Fetch requests target one origin; HTTP/2 or HTTP/3 may multiplex them onto fewer transport connections than the request count.");
  }
  const reliableLimited = publication.reliable.status !== "measured";
  if (reliableLimited) reasons.push("Reliable throughput did not have a fully qualified stable-window stage.");
  if (plan.profileMode !== "full") {
    reasons.push(`${plan.profileMode === "lowData" ? "Low-data" : "Quick"} mode has a reduced payload budget and cannot certify full high-speed capacity.`);
  }
  reasons.push(...selection.excludedReasons);
  return {
    direction: plan.direction,
    maximumMbps,
    reliable: {
      status: publication.reliable.status,
      mbps: reliableMbps,
      singleStreamMbps,
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
      method: "P25 of stable fixed-window application throughput samples from the best qualified stage using at most four concurrent requests.",
      limitation: reliableLimited
        ? publication.reliable.reasons.join(" ")
        : null,
    },
    singleStreamMbps,
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
    publication,
  };
}
