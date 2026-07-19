/**
 * Download and upload throughput with cache-busting, no-store, single- and
 * multi-connection runs, measured payload accounting, rolling progress,
 * duration/data caps, early stopping, and raw sample storage.
 */
import { getServer } from "./servers";
import { coefficientOfVariation, max } from "./stats";
import { pingOnce } from "./latency";
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
};

const SAMPLE_MS = 250; // rolling sample window
const PROBE_MS = 500; // loaded-latency probe cadence
const EARLY_STOP_COV = 0.05; // stop once the stable window is this steady
const EARLY_STOP_MIN_SAMPLES = 12;

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
 * upload progress is the cumulative accepted payload rate after each POST.
 */
async function runLoad(
  opts: LoadOpts,
  direction: "download" | "upload",
  worker: (
    signal: AbortSignal,
    count: (n: number) => void,
    cap: () => boolean,
    fail: () => void,
  ) => Promise<void>,
): Promise<ThroughputStats & { rtts: number[] }> {
  const ctrl = new AbortController();
  const samples: number[] = [];
  const rtts: number[] = [];
  let windowBytes = 0;
  let totalBytes = 0;
  let failedRequests = 0;
  let earlyStopped = false;
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
    if (elapsed > opts.minDurationMs && samples.length >= EARLY_STOP_MIN_SAMPLES) {
      const stable = samples.slice(Math.floor(samples.length / 2));
      if (coefficientOfVariation(stable) < EARLY_STOP_COV) {
        earlyStopped = true;
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

  const stopper = setTimeout(() => ctrl.abort(), opts.maxDurationMs);
  // Start the traffic first. This guarantees that every latency probe below
  // begins while at least one load request is already in flight.
  const load = worker(ctrl.signal, recordBytes, cap, () => {
    failedRequests++;
  });

  let probing = true;
  const prober = (async () => {
    while (probing && !ctrl.signal.aborted) {
      const rtt = await pingOnce(opts.serverId);
      // Keep a probe that started while load was active even if the load phase
      // reached its byte cap before the HTTP round trip finished.
      if (rtt !== null) {
        rtts.push(rtt);
        opts.onRtt?.(rtt);
      }
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
  await prober;

  if (totalBytes === 0) {
    throw new Error(
      `${direction === "download" ? "Download" : "Upload"} measurement failed: the test endpoint transferred no usable data.`,
    );
  }

  const durationMs = loadEndedAt - start;
  const mbps = (totalBytes * 8) / durationMs / 1000;
  // Emit the final authoritative result as the last live sample. For uploads,
  // this is also the only defensible peak because fetch exposes no byte-level
  // upload progress.
  opts.onThroughput?.(mbps);

  return {
    mbps,
    peakMbps: direction === "download" ? Math.max(mbps, max(samples)) : mbps,
    samples,
    cov: coefficientOfVariation(samples.slice(Math.floor(samples.length / 2))),
    bytes: totalBytes,
    durationMs,
    earlyStopped,
    failedRequests,
    rtts,
  };
}

export function downloadPhase(opts: LoadOpts) {
  const server = getServer(opts.serverId);
  return runLoad(opts, "download", (signal, count, cap, fail) => {
    const workers: Promise<void>[] = [];
    for (let w = 0; w < opts.streams; w++) {
      workers.push(
        (async () => {
          while (!signal.aborted && !cap()) {
            try {
              // Cache-buster query + no-store defeat any intermediary caching.
              const url = `${server.downPath(opts.chunkBytes)}&cb=${Math.random().toString(36).slice(2)}`;
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

export function uploadPhase(opts: LoadOpts) {
  const server = getServer(opts.serverId);
  // Non-personal payload generated in memory. Web Crypto limits each call to
  // 65,536 bytes, so fill the request body in chunks rather than leaving most
  // of it zeroed and potentially compressible.
  const body = new Uint8Array(opts.chunkBytes);
  for (let offset = 0; offset < body.length; offset += 65_536) {
    crypto.getRandomValues(body.subarray(offset, Math.min(offset + 65_536, body.length)));
  }
  return runLoad(opts, "upload", (signal, count, cap, fail) => {
    const workers: Promise<void>[] = [];
    for (let w = 0; w < opts.streams; w++) {
      workers.push(
        (async () => {
          while (!signal.aborted && !cap()) {
            try {
              const res = await fetch(server.upPath, { method: "POST", body, cache: "no-store", signal });
              if (!res.ok) {
                fail();
                break;
              }
              count(opts.chunkBytes);
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
