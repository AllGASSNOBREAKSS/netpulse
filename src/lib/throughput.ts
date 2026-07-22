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
import type { ThroughputStats } from "./types";

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

type Warmup = { bytes: number; durationMs: number; succeeded: boolean };

async function downloadWarmup(serverId: string | undefined, signal?: AbortSignal): Promise<Warmup> {
  const server = getServer(serverId);
  const ctrl = new AbortController();
  const unlink = linkAbortSignal(ctrl, signal);
  const timer = setTimeout(() => ctrl.abort(), WARMUP_TIMEOUT_MS);
  const started = performance.now();
  try {
    const response = await fetch(withCacheBuster(server.downPath(DOWNLOAD_WARMUP_BYTES)), {
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (!response.ok) return { bytes: 0, durationMs: performance.now() - started, succeeded: false };
    const bytes = (await response.arrayBuffer()).byteLength;
    return { bytes, durationMs: performance.now() - started, succeeded: bytes > 0 };
  } catch {
    throwIfCancelled(signal);
    return { bytes: 0, durationMs: performance.now() - started, succeeded: false };
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
  const timer = setTimeout(() => ctrl.abort(), WARMUP_TIMEOUT_MS);
  const started = performance.now();
  try {
    const response = await fetch(withCacheBuster(server.upPath), {
      method: "POST",
      body,
      cache: "no-store",
      signal: ctrl.signal,
    });
    const durationMs = performance.now() - started;
    return response.ok
      ? { bytes: body.byteLength, durationMs, succeeded: true }
      : { bytes: 0, durationMs, succeeded: false };
  } catch {
    throwIfCancelled(signal);
    return { bytes: 0, durationMs: performance.now() - started, succeeded: false };
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
  ) => Promise<void>,
): Promise<ThroughputStats & { rtts: number[] }> {
  const ctrl = new AbortController();
  const unlink = linkAbortSignal(ctrl, opts.signal);
  const calibrationMbps = warmupMbps(warmup);
  const streams = calibratedStreams(opts.streams, calibrationMbps);
  const samples: number[] = [];
  const rtts: number[] = [];
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
  const load = worker(ctrl.signal, recordBytes, cap, () => {
    failedRequests++;
  });

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
  opts.onStage?.("measuring", warmup);
  const requestBytes = adaptiveRequestBytes(warmup.bytes, warmup.durationMs, opts.chunkBytes, "download");
  const measuredOpts = {
    ...opts,
    chunkBytes: requestBytes,
    onBytes: (bytes: number) => opts.onBytes?.(warmup.bytes + bytes),
  };
  opts.onBytes?.(warmup.bytes);
  return runLoad(measuredOpts, "download", warmup, requestBytes, (signal, count, cap, fail) => {
    const workers: Promise<void>[] = [];
    const streams = calibratedStreams(opts.streams, warmupMbps(warmup));
    for (let w = 0; w < streams; w++) {
      workers.push(
        (async () => {
          while (!signal.aborted && !cap()) {
            try {
              // Cache-buster query + no-store defeat any intermediary caching.
              const url = withCacheBuster(server.downPath(requestBytes));
              const res = await fetch(url, { cache: "no-store", signal });
              if (!res.ok) {
                fail();
                break;
              }
              const reader = res.body?.getReader();
              if (!reader) {
                fail();
                break;
              }
              for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                count(value.byteLength);
                if (cap()) {
                  void reader.cancel();
                  break;
                }
              }
            } catch {
              if (!signal.aborted) fail();
              break;
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
  return runLoad(measuredOpts, "upload", warmup, requestBytes, (signal, count, cap, fail) => {
    const workers: Promise<void>[] = [];
    const streams = calibratedStreams(opts.streams, warmupMbps(warmup));
    for (let w = 0; w < streams; w++) {
      workers.push(
        (async () => {
          while (!signal.aborted && !cap()) {
            try {
              const res = await fetch(withCacheBuster(server.upPath), {
                method: "POST",
                body,
                cache: "no-store",
                signal,
              });
              if (!res.ok) {
                fail();
                break;
              }
              count(requestBytes);
            } catch {
              if (!signal.aborted) fail();
              break;
            }
          }
        })(),
      );
    }
    return Promise.allSettled(workers).then(() => {});
  });
}
