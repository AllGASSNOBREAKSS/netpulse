/**
 * Download and upload throughput with warm-up, cache-busting, no-store,
 * adaptive payloads, single- and multi-connection runs, rolling sampling,
 * duration/data caps, early stopping on confidence, and raw sample storage.
 */
import { getServer } from "./servers";
import { coefficientOfVariation, max, topHalfMedian } from "./stats";
import { pingOnce } from "./latency";
import type { ThroughputStats } from "./types";

export type LoadOpts = {
  serverId?: string;
  streams: number;
  /** Hard ceiling on how long the phase may run. */
  maxDurationMs: number;
  /** Hard ceiling on bytes moved (data cap). */
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

/** Shared rolling-sample loop used by both download and upload. */
async function runLoad(
  opts: LoadOpts,
  worker: (signal: AbortSignal, count: (n: number) => void, cap: () => boolean) => Promise<void>,
): Promise<ThroughputStats & { rtts: number[] }> {
  const ctrl = new AbortController();
  const samples: number[] = [];
  const rtts: number[] = [];
  let windowBytes = 0;
  let totalBytes = 0;
  let earlyStopped = false;
  const start = performance.now();

  const cap = () => totalBytes >= opts.maxBytes || ctrl.signal.aborted;

  const sampler = setInterval(() => {
    const mbps = (windowBytes * 8) / SAMPLE_MS / 1000;
    windowBytes = 0;
    if (mbps > 0) {
      samples.push(mbps);
      opts.onThroughput?.(mbps);
    }
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

  let probing = true;
  const prober = (async () => {
    await new Promise((r) => setTimeout(r, 300));
    while (probing && !ctrl.signal.aborted) {
      const rtt = await pingOnce(opts.serverId);
      if (rtt !== null && probing) {
        rtts.push(rtt);
        opts.onRtt?.(rtt);
      }
      await new Promise((r) => setTimeout(r, PROBE_MS));
    }
  })();

  const stopper = setTimeout(() => ctrl.abort(), opts.maxDurationMs);
  await worker(
    ctrl.signal,
    (n) => {
      windowBytes += n;
      totalBytes += n;
      opts.onBytes?.(totalBytes);
    },
    cap,
  );
  clearTimeout(stopper);
  ctrl.abort();
  clearInterval(sampler);
  probing = false;
  await prober;

  return {
    mbps: topHalfMedian(samples),
    peakMbps: max(samples),
    samples,
    cov: coefficientOfVariation(samples.slice(Math.floor(samples.length / 2))),
    bytes: totalBytes,
    durationMs: performance.now() - start,
    earlyStopped,
    rtts,
  };
}

export function downloadPhase(opts: LoadOpts) {
  const server = getServer(opts.serverId);
  return runLoad(opts, (signal, count, cap) => {
    const workers: Promise<void>[] = [];
    for (let w = 0; w < opts.streams; w++) {
      workers.push(
        (async () => {
          while (!signal.aborted && !cap()) {
            try {
              // Cache-buster query + no-store defeat any intermediary caching.
              const url = `${server.downPath(opts.chunkBytes)}&cb=${Math.random().toString(36).slice(2)}`;
              const res = await fetch(url, { cache: "no-store", signal });
              const reader = res.body?.getReader();
              if (!reader) break;
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
  // Non-personal payload generated in memory; a small random header defeats
  // any content-based compression on the path.
  const body = new Uint8Array(opts.chunkBytes);
  crypto.getRandomValues(body.subarray(0, Math.min(65536, opts.chunkBytes)));
  return runLoad(opts, (signal, count, cap) => {
    const workers: Promise<void>[] = [];
    for (let w = 0; w < opts.streams; w++) {
      workers.push(
        (async () => {
          while (!signal.aborted && !cap()) {
            try {
              await fetch(server.upPath, { method: "POST", body, cache: "no-store", signal });
              count(opts.chunkBytes);
            } catch {
              break;
            }
          }
        })(),
      );
    }
    return Promise.allSettled(workers).then(() => {});
  });
}
