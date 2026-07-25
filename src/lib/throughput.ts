/**
 * Download and upload throughput with cache-busting, no-store, single- and
 * multi-connection runs, measured payload accounting, rolling progress,
 * duration/data caps, early stopping, and raw sample storage.
 */
import { getServer } from "./servers";
import { DOWNLOAD_WARMUP_BYTES, UPLOAD_WARMUP_BYTES } from "./profiles";
import { coefficientOfVariation, max, median, percentile } from "./stats";
import { pingOnce } from "./latency";
import { linkAbortSignal, MeasurementCancelledError, throwIfCancelled } from "./cancellation";
import type { StreamDiagnostic, ThroughputStats } from "./types";

export type LoadOpts = {
  serverId?: string;
  streams: number;
  /** Hard ceiling on how long the phase may run. */
  maxDurationMs: number;
  /** Payload cap; in-flight parallel requests can overshoot slightly. */
  maxBytes: number;
  /** Minimum time before early-stop can trigger. */
  minDurationMs: number;
  /** Adaptive per-request payload size (bytes). */
  chunkBytes: number;
  onThroughput?: (mbps: number) => void;
  onRtt?: (rtt: number) => void;
  onBytes?: (total: number) => void;
  signal?: AbortSignal;
  onStage?: (stage: "warming-up" | "measuring", warmup?: Warmup) => void;
  onDiagnostic?: (diagnostic: StreamDiagnostic) => void;
};

const SAMPLE_MS = 250; // rolling sample window
const PROBE_MS = 500; // loaded-latency probe cadence
const EARLY_STOP_COV = 0.05; // stop once the stable window is this steady
const EARLY_STOP_MIN_SAMPLES = 12;
const WARMUP_TIMEOUT_MS = 5000;

let cacheSequence = 0;

function cacheBuster(): string {
  cacheSequence = (cacheSequence + 1) % Number.MAX_SAFE_INTEGER;
  return `${Math.round(performance.now() * 1000).toString(36)}-${cacheSequence.toString(36)}`;
}

function withCacheBuster(url: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}cb=${cacheBuster()}`;
}

function adaptiveRequestBytes(
  measuredBytes: number,
  durationMs: number,
  configuredMaximum: number,
  direction: "download" | "upload",
): number {
  if (measuredBytes <= 0 || durationMs <= 0) return configuredMaximum;
  const bytesPerSecond = measuredBytes / (durationMs / 1000);
  const targetSeconds = direction === "download" ? 0.75 : 0.5;
  const minimum = direction === "download" ? 500_000 : 128_000;
  return Math.round(Math.min(configuredMaximum, Math.max(minimum, bytesPerSecond * targetSeconds)));
}

function randomPayload(bytes: number): ArrayBuffer {
  const body = new ArrayBuffer(bytes);
  const view = new Uint8Array(body);
  for (let offset = 0; offset < view.length; offset += 65_536) {
    crypto.getRandomValues(view.subarray(offset, Math.min(offset + 65_536, view.length)));
  }
  return body;
}

type Warmup = {
  bytes: number;
  durationMs: number;
  succeeded: boolean;
  diagnostics: StreamDiagnostic[];
};

type DiagnosticResponse = {
  status: number;
  cacheControl: string | null;
  contentEncoding: string | null;
  contentLength: number | null;
  serverAcceptedBytes: number | null;
};

function canonicalEndpoint(url: string): string {
  try {
    const parsed = new URL(url, typeof location === "undefined" ? "https://netpulse.invalid" : location.origin);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "unavailable";
  }
}

function boundedHeaderNumber(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function responseFacts(response: Response): DiagnosticResponse {
  return {
    status: response.status,
    cacheControl: response.headers.get("cache-control"),
    contentEncoding: response.headers.get("content-encoding"),
    contentLength: boundedHeaderNumber(response.headers.get("content-length")),
    serverAcceptedBytes: boundedHeaderNumber(response.headers.get("cf-meta-upload-bytes")),
  };
}

function browserProtocol(url: string): string | null {
  if (typeof performance.getEntriesByName !== "function") return null;
  const entries = performance.getEntriesByName(url, "resource") as PerformanceResourceTiming[];
  const entry = entries.at(-1);
  return entry?.nextHopProtocol || null;
}

function failureReason(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`.slice(0, 180);
  return "Unknown request failure.";
}

function buildDiagnostic(input: {
  direction: "download" | "upload";
  stage: "warmup" | "measurement";
  streamId: number;
  requestId: number;
  url: string;
  startedAtMs: number;
  responseAtMs: number | null;
  firstByteAtMs: number | null;
  endedAtMs: number;
  bytes: number;
  response: DiagnosticResponse | null;
  outcome: StreamDiagnostic["outcome"];
  failureReason: string | null;
}): StreamDiagnostic {
  const transferStartedAt = input.firstByteAtMs ?? (
    input.direction === "upload" && input.responseAtMs !== null ? input.startedAtMs : null
  );
  const transferDurationMs = transferStartedAt === null
    ? null
    : Math.max(0, input.endedAtMs - transferStartedAt);
  return {
    direction: input.direction,
    stage: input.stage,
    stageStreams: null,
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
      ? (input.bytes * 8) / transferDurationMs / 1000
      : null,
    httpStatus: input.response?.status ?? null,
    protocol: browserProtocol(input.url),
    cacheControl: input.response?.cacheControl ?? null,
    contentEncoding: input.response?.contentEncoding ?? null,
    contentLength: input.response?.contentLength ?? null,
    serverAcceptedBytes: input.response?.serverAcceptedBytes ?? null,
    outcome: input.outcome,
    failureReason: input.failureReason,
  };
}

function emitDiagnostic(diagnostic: StreamDiagnostic, callback?: (value: StreamDiagnostic) => void): void {
  callback?.(diagnostic);
  if (import.meta.env.DEV && import.meta.env.MODE !== "test" && typeof window !== "undefined") {
    console.debug(`[NetPulse stream diagnostic] ${JSON.stringify(diagnostic)}`);
  }
}

async function downloadWarmup(serverId: string | undefined, signal?: AbortSignal): Promise<Warmup> {
  const server = getServer(serverId);
  const ctrl = new AbortController();
  const unlink = linkAbortSignal(ctrl, signal);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, WARMUP_TIMEOUT_MS);
  const url = withCacheBuster(server.downPath(DOWNLOAD_WARMUP_BYTES));
  const started = performance.now();
  let responseAt: number | null = null;
  let firstByteAt: number | null = null;
  let facts: DiagnosticResponse | null = null;
  let bytes = 0;
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: ctrl.signal,
    });
    responseAt = performance.now();
    facts = responseFacts(response);
    if (!response.ok || !response.body) {
      const endedAt = performance.now();
      const diagnostic = buildDiagnostic({
        direction: "download", stage: "warmup", streamId: 0, requestId: 0, url,
        startedAtMs: started, responseAtMs: responseAt, firstByteAtMs: null, endedAtMs: endedAt,
        bytes: 0, response: facts, outcome: "failed",
        failureReason: response.ok ? "Response body was unavailable." : `HTTP ${response.status}.`,
      });
      return { bytes: 0, durationMs: endedAt - started, succeeded: false, diagnostics: [diagnostic] };
    }
    const reader = response.body.getReader();
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (firstByteAt === null && chunk.value.byteLength > 0) firstByteAt = performance.now();
      bytes += chunk.value.byteLength;
    }
    const endedAt = performance.now();
    const diagnostic = buildDiagnostic({
      direction: "download", stage: "warmup", streamId: 0, requestId: 0, url,
      startedAtMs: started, responseAtMs: responseAt, firstByteAtMs: firstByteAt, endedAtMs: endedAt,
      bytes, response: facts, outcome: "completed", failureReason: null,
    });
    return { bytes, durationMs: endedAt - started, succeeded: bytes > 0, diagnostics: [diagnostic] };
  } catch (error) {
    throwIfCancelled(signal);
    const endedAt = performance.now();
    const diagnostic = buildDiagnostic({
      direction: "download", stage: "warmup", streamId: 0, requestId: 0, url,
      startedAtMs: started, responseAtMs: responseAt, firstByteAtMs: firstByteAt, endedAtMs: endedAt,
      bytes, response: facts, outcome: ctrl.signal.aborted ? "aborted" : "failed",
      failureReason: timedOut ? "Warm-up timeout." : failureReason(error),
    });
    return { bytes: 0, durationMs: endedAt - started, succeeded: false, diagnostics: [diagnostic] };
  } finally {
    clearTimeout(timer);
    unlink();
  }
}

async function uploadWarmup(serverId: string | undefined, signal?: AbortSignal): Promise<Warmup> {
  const server = getServer(serverId);
  const body = randomPayload(UPLOAD_WARMUP_BYTES);
  const ctrl = new AbortController();
  const unlink = linkAbortSignal(ctrl, signal);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, WARMUP_TIMEOUT_MS);
  const url = withCacheBuster(server.upPath);
  const started = performance.now();
  let responseAt: number | null = null;
  let facts: DiagnosticResponse | null = null;
  try {
    const response = await fetch(url, {
      method: "POST",
      body,
      cache: "no-store",
      signal: ctrl.signal,
    });
    responseAt = performance.now();
    facts = responseFacts(response);
    const endedAt = performance.now();
    const durationMs = endedAt - started;
    const diagnostic = buildDiagnostic({
      direction: "upload", stage: "warmup", streamId: 0, requestId: 0, url,
      startedAtMs: started, responseAtMs: responseAt, firstByteAtMs: null, endedAtMs: endedAt,
      bytes: response.ok ? body.byteLength : 0, response: facts,
      outcome: response.ok ? "completed" : "failed",
      failureReason: response.ok ? null : `HTTP ${response.status}.`,
    });
    return response.ok
      ? { bytes: body.byteLength, durationMs, succeeded: true, diagnostics: [diagnostic] }
      : { bytes: 0, durationMs, succeeded: false, diagnostics: [diagnostic] };
  } catch (error) {
    throwIfCancelled(signal);
    const endedAt = performance.now();
    const diagnostic = buildDiagnostic({
      direction: "upload", stage: "warmup", streamId: 0, requestId: 0, url,
      startedAtMs: started, responseAtMs: responseAt, firstByteAtMs: null, endedAtMs: endedAt,
      bytes: 0, response: facts, outcome: ctrl.signal.aborted ? "aborted" : "failed",
      failureReason: timedOut ? "Warm-up timeout." : failureReason(error),
    });
    return { bytes: 0, durationMs: endedAt - started, succeeded: false, diagnostics: [diagnostic] };
  } finally {
    clearTimeout(timer);
    unlink();
  }
}

function warmupMbps(warmup: Warmup): number | null {
  return warmup.succeeded && warmup.bytes > 0 && warmup.durationMs > 0
    ? (warmup.bytes * 8) / warmup.durationMs / 1000
    : null;
}

function calibratedStreams(configured: number, calibrationMbps: number | null): number {
  if (configured <= 1 || calibrationMbps === null) return Math.max(1, configured);
  if (calibrationMbps < 10) return 1;
  if (calibrationMbps < 100) return Math.min(configured, 2);
  if (calibrationMbps < 500) return Math.min(configured, 4);
  return configured;
}

function waitForProbeCadence(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    if (signal.aborted) finish();
    else signal.addEventListener("abort", finish, { once: true });
  });
}

/**
 * Shared load runner. The authoritative result is transferred application
 * payload divided by the phase's actual elapsed time. Download progress can be
 * sampled from streamed chunks; browsers do not expose upload progress, so
 * upload progress is the cumulative successfully submitted payload rate after each POST.
 */
async function runLoad(
  opts: LoadOpts,
  direction: "download" | "upload",
  warmup: Warmup,
  requestBytes: number,
  worker: (
    signal: AbortSignal,
    count: (n: number) => void,
    cap: () => boolean,
    fail: () => void,
    diagnose: (diagnostic: StreamDiagnostic) => void,
  ) => Promise<void>,
): Promise<ThroughputStats & { rtts: number[] }> {
  const ctrl = new AbortController();
  const unlink = linkAbortSignal(ctrl, opts.signal);
  const calibrationMbps = warmupMbps(warmup);
  const streams = calibratedStreams(opts.streams, calibrationMbps);
  const samples: number[] = [];
  const rtts: number[] = [];
  const diagnostics = [...warmup.diagnostics];
  let windowBytes = 0;
  let totalBytes = 0;
  let failedRequests = 0;
  let failedProbes = 0;
  let earlyStopped = false;
  let stableAtMs: number | null = null;
  let durationExpired = false;
  const start = performance.now();
  let windowStartedAt = start;

  const cap = () => totalBytes >= opts.maxBytes || ctrl.signal.aborted;

  // Use the actual elapsed time rather than assuming the interval fired on
  // schedule. Background tabs and busy main threads can delay timers, and a
  // fixed 250 ms denominator would overstate throughput in those cases.
  const recordSample = (mbps: number) => {
    if (!Number.isFinite(mbps) || mbps < 0) return;
    samples.push(mbps);
    opts.onThroughput?.(mbps);
  };

  const flushDownloadSample = (now = performance.now(), final = false) => {
    const elapsedMs = now - windowStartedAt;
    const bytes = windowBytes;
    windowBytes = 0;
    windowStartedAt = now;
    if (elapsedMs <= 0) return;
    // A very short tail reflects event-loop delivery more than network rate.
    // It remains included in the authoritative phase average, but not as a
    // misleading instantaneous peak.
    if (final && elapsedMs < SAMPLE_MS / 2 && samples.length > 0) return;
    if (bytes === 0 && totalBytes === 0) return;
    const sampleBytes = final && samples.length === 0 ? totalBytes : bytes;
    const sampleElapsed = final && samples.length === 0 ? now - start : elapsedMs;
    recordSample((sampleBytes * 8) / sampleElapsed / 1000);
  };

  const sampler = setInterval(() => {
    if (direction === "download") flushDownloadSample();
    const elapsed = performance.now() - start;
    // Early stop: enough steady samples past the minimum duration.
    if (direction === "download" && elapsed > opts.minDurationMs && samples.length >= EARLY_STOP_MIN_SAMPLES) {
      const stable = samples.slice(Math.floor(samples.length / 2));
      if (coefficientOfVariation(stable) < EARLY_STOP_COV) {
        earlyStopped = true;
        stableAtMs = elapsed;
        ctrl.abort();
      }
    }
  }, SAMPLE_MS);

  const recordBytes = (n: number) => {
    totalBytes += n;
    opts.onBytes?.(totalBytes);
    if (direction === "download") {
      windowBytes += n;
      return;
    }
    const elapsedMs = performance.now() - start;
    if (elapsedMs > 0) recordSample((totalBytes * 8) / elapsedMs / 1000);
  };

  const stopper = setTimeout(() => {
    durationExpired = true;
    ctrl.abort();
  }, opts.maxDurationMs);
  // Start the traffic first. This guarantees that every latency probe below
  // begins while at least one load request is already in flight.
  const recordDiagnostic = (diagnostic: StreamDiagnostic) => {
    diagnostics.push(diagnostic);
    emitDiagnostic(diagnostic, opts.onDiagnostic);
  };
  const load = worker(ctrl.signal, recordBytes, cap, () => {
    failedRequests++;
  }, recordDiagnostic);

  let probing = true;
  const prober = (async () => {
    while (probing && !ctrl.signal.aborted) {
      const rtt = await pingOnce(opts.serverId, undefined, opts.signal);
      // Keep a probe that started while load was active even if the load phase
      // reached its byte cap before the HTTP round trip finished.
      if (rtt !== null) {
        rtts.push(rtt);
        opts.onRtt?.(rtt);
      } else failedProbes++;
      if (!probing || ctrl.signal.aborted) break;
      await waitForProbeCadence(PROBE_MS, ctrl.signal);
    }
  })();

  await load;
  const loadEndedAt = performance.now();
  clearTimeout(stopper);
  ctrl.abort();
  clearInterval(sampler);
  // Fast or byte-capped phases may complete before the first 250 ms tick. The
  // final partial window is still a real timed measurement and must not be
  // discarded, otherwise a fast connection can incorrectly report 0 Mbps.
  if (direction === "download") flushDownloadSample(loadEndedAt, true);
  probing = false;
  try {
    await prober;
  } catch (error) {
    unlink();
    throw error;
  }

  if (opts.signal?.aborted) {
    unlink();
    throw new MeasurementCancelledError();
  }

  if (totalBytes === 0) {
    unlink();
    throw new Error(
      `${direction === "download" ? "Download" : "Upload"} measurement failed: the test endpoint transferred no usable data.`,
    );
  }

  const durationMs = loadEndedAt - start;
  if (failedRequests >= streams && durationMs < opts.minDurationMs && totalBytes < opts.maxBytes) {
    unlink();
    throw new Error(
      `${direction === "download" ? "Download" : "Upload"} measurement failed: every stream stopped before the minimum measurement duration.`,
    );
  }
  const mbps = (totalBytes * 8) / durationMs / 1000;
  // Emit the final authoritative result as the last live sample. For uploads,
  // this is also the only defensible peak because fetch exposes no byte-level
  // upload progress.
  opts.onThroughput?.(mbps);

  const stopReason: ThroughputStats["stopReason"] = earlyStopped
    ? "stable"
    : durationExpired
      ? "duration"
      : totalBytes >= opts.maxBytes
        ? "data-cap"
        : failedRequests > 0
          ? "error"
          : "completed";
  const result: ThroughputStats & { rtts: number[] } = {
    mbps,
    peakMbps: Math.max(mbps, max(samples)),
    medianMbps: samples.length ? median(samples) : mbps,
    p5Mbps: samples.length ? percentile(samples, 5) : mbps,
    p95Mbps: samples.length ? percentile(samples, 95) : mbps,
    variationPct: Math.round(coefficientOfVariation(samples) * 1000) / 10,
    samples,
    cov: coefficientOfVariation(samples.slice(Math.floor(samples.length / 2))),
    bytes: totalBytes,
    warmupBytes: warmup.bytes,
    warmupSucceeded: warmup.succeeded,
    requestBytes,
    streams,
    calibrationMbps,
    durationMs,
    earlyStopped,
    stableAtMs,
    stopReason,
    failedRequests,
    failedProbes,
    diagnostics,
    rtts,
  };
  unlink();
  return result;
}

export async function downloadPhase(opts: LoadOpts) {
  const server = getServer(opts.serverId);
  throwIfCancelled(opts.signal);
  opts.onStage?.("warming-up");
  const warmup = await downloadWarmup(opts.serverId, opts.signal);
  warmup.diagnostics.forEach((diagnostic) => emitDiagnostic(diagnostic, opts.onDiagnostic));
  opts.onStage?.("measuring", warmup);
  const requestBytes = adaptiveRequestBytes(warmup.bytes, warmup.durationMs, opts.chunkBytes, "download");
  const measuredOpts = {
    ...opts,
    chunkBytes: requestBytes,
    onBytes: (bytes: number) => opts.onBytes?.(warmup.bytes + bytes),
  };
  opts.onBytes?.(warmup.bytes);
  return runLoad(measuredOpts, "download", warmup, requestBytes, (signal, count, cap, fail, diagnose) => {
    const workers: Promise<void>[] = [];
    const streams = calibratedStreams(opts.streams, warmupMbps(warmup));
    for (let streamId = 0; streamId < streams; streamId++) {
      workers.push(
        (async () => {
          let requestId = 0;
          while (!signal.aborted && !cap()) {
            const url = withCacheBuster(server.downPath(requestBytes));
            const startedAtMs = performance.now();
            let responseAtMs: number | null = null;
            let firstByteAtMs: number | null = null;
            let facts: DiagnosticResponse | null = null;
            let requestReceivedBytes = 0;
            let diagnosticEmitted = false;
            try {
              // Cache-buster query + no-store defeat any intermediary caching.
              const res = await fetch(url, { cache: "no-store", signal });
              responseAtMs = performance.now();
              facts = responseFacts(res);
              if (!res.ok) {
                fail();
                diagnose(buildDiagnostic({
                  direction: "download", stage: "measurement", streamId, requestId, url,
                  startedAtMs, responseAtMs, firstByteAtMs: null, endedAtMs: performance.now(),
                  bytes: 0, response: facts, outcome: "failed", failureReason: `HTTP ${res.status}.`,
                }));
                diagnosticEmitted = true;
                break;
              }
              const reader = res.body?.getReader();
              if (!reader) {
                fail();
                diagnose(buildDiagnostic({
                  direction: "download", stage: "measurement", streamId, requestId, url,
                  startedAtMs, responseAtMs, firstByteAtMs: null, endedAtMs: performance.now(),
                  bytes: 0, response: facts, outcome: "failed", failureReason: "Response body was unavailable.",
                }));
                diagnosticEmitted = true;
                break;
              }
              let stoppedAtCap = false;
              for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                if (firstByteAtMs === null && value.byteLength > 0) firstByteAtMs = performance.now();
                requestReceivedBytes += value.byteLength;
                count(value.byteLength);
                if (cap()) {
                  stoppedAtCap = true;
                  void reader.cancel();
                  break;
                }
              }
              diagnose(buildDiagnostic({
                direction: "download", stage: "measurement", streamId, requestId, url,
                startedAtMs, responseAtMs, firstByteAtMs, endedAtMs: performance.now(),
                bytes: requestReceivedBytes, response: facts,
                outcome: stoppedAtCap ? "aborted" : "completed",
                failureReason: stoppedAtCap ? "Measurement phase reached its stop condition." : null,
              }));
              diagnosticEmitted = true;
            } catch (error) {
              if (!signal.aborted) fail();
              if (!diagnosticEmitted) diagnose(buildDiagnostic({
                direction: "download", stage: "measurement", streamId, requestId, url,
                startedAtMs, responseAtMs, firstByteAtMs, endedAtMs: performance.now(),
                bytes: requestReceivedBytes, response: facts,
                outcome: signal.aborted ? "aborted" : "failed",
                failureReason: signal.aborted ? "Measurement phase stopped." : failureReason(error),
              }));
              break;
            } finally {
              requestId += 1;
            }
          }
        })(),
      );
    }
    return Promise.allSettled(workers).then(() => {});
  });
}

export async function uploadPhase(opts: LoadOpts) {
  const server = getServer(opts.serverId);
  throwIfCancelled(opts.signal);
  opts.onStage?.("warming-up");
  const warmup = await uploadWarmup(opts.serverId, opts.signal);
  warmup.diagnostics.forEach((diagnostic) => emitDiagnostic(diagnostic, opts.onDiagnostic));
  opts.onStage?.("measuring", warmup);
  const requestBytes = adaptiveRequestBytes(warmup.bytes, warmup.durationMs, opts.chunkBytes, "upload");
  // Non-personal payload generated in memory. Web Crypto limits each call to
  // 65,536 bytes, so fill every chunk rather than leaving compressible zeroes.
  const body = randomPayload(requestBytes);
  const measuredOpts = {
    ...opts,
    chunkBytes: requestBytes,
    onBytes: (bytes: number) => opts.onBytes?.(warmup.bytes + bytes),
  };
  opts.onBytes?.(warmup.bytes);
  return runLoad(measuredOpts, "upload", warmup, requestBytes, (signal, count, cap, fail, diagnose) => {
    const workers: Promise<void>[] = [];
    const streams = calibratedStreams(opts.streams, warmupMbps(warmup));
    for (let streamId = 0; streamId < streams; streamId++) {
      workers.push(
        (async () => {
          let requestId = 0;
          while (!signal.aborted && !cap()) {
            const url = withCacheBuster(server.upPath);
            const startedAtMs = performance.now();
            let responseAtMs: number | null = null;
            let facts: DiagnosticResponse | null = null;
            try {
              const res = await fetch(url, {
                method: "POST",
                body,
                cache: "no-store",
                signal,
              });
              responseAtMs = performance.now();
              facts = responseFacts(res);
              if (!res.ok) {
                fail();
                diagnose(buildDiagnostic({
                  direction: "upload", stage: "measurement", streamId, requestId, url,
                  startedAtMs, responseAtMs, firstByteAtMs: null, endedAtMs: performance.now(),
                  bytes: 0, response: facts, outcome: "failed", failureReason: `HTTP ${res.status}.`,
                }));
                break;
              }
              count(requestBytes);
              diagnose(buildDiagnostic({
                direction: "upload", stage: "measurement", streamId, requestId, url,
                startedAtMs, responseAtMs, firstByteAtMs: null, endedAtMs: performance.now(),
                bytes: requestBytes, response: facts, outcome: "completed", failureReason: null,
              }));
            } catch (error) {
              if (!signal.aborted) fail();
              diagnose(buildDiagnostic({
                direction: "upload", stage: "measurement", streamId, requestId, url,
                startedAtMs, responseAtMs, firstByteAtMs: null, endedAtMs: performance.now(),
                bytes: 0, response: facts, outcome: signal.aborted ? "aborted" : "failed",
                failureReason: signal.aborted ? "Measurement phase stopped." : failureReason(error),
              }));
              break;
            } finally {
              requestId += 1;
            }
          }
        })(),
      );
    }
    return Promise.allSettled(workers).then(() => {});
  });
}
