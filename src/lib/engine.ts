/**
 * NetPulse measurement engine.
 *
 * Tests against Cloudflare's public speed-test endpoints (the same ones
 * speed.cloudflare.com uses):
 *   GET  https://speed.cloudflare.com/__down?bytes=N   → download
 *   POST https://speed.cloudflare.com/__up             → upload
 *
 * Measures: idle latency + jitter, download throughput, upload throughput,
 * latency UNDER download and upload load (bufferbloat), stability (latency
 * spikes), and total data consumed. Everything is sampled continuously so the
 * UI can draw a live trace.
 */

const BASE = "https://speed.cloudflare.com";

export type Phase = "idle" | "latency" | "download" | "upload" | "done" | "error";

export type Sample = {
  t: number; // ms since test start
  phase: Phase;
  mbps?: number; // instantaneous throughput
  rttMs?: number; // latency probe result
};

export type TestConfig = {
  lowData: boolean;
};

/**
 * Stream counts per mode. Exported so the UI labels phases with the stream
 * count that actually ran — never a hard-coded guess.
 */
export const PROFILES = {
  full: { dlStreams: 3, ulStreams: 2 },
  lowData: { dlStreams: 1, ulStreams: 1 },
} as const;

export type TestResult = {
  timestamp: number;
  downloadMbps: number;
  uploadMbps: number;
  idlePingMs: number;
  idleJitterMs: number;
  loadedDownPingMs: number;
  loadedUpPingMs: number;
  bufferbloatMs: number;
  bufferbloatGrade: "A" | "B" | "C" | "D" | "F";
  spikes: number;
  probeCount: number;
  dataUsedMB: number;
  durationMs: number;
  lowData: boolean;
  samples: Sample[];
};

export type EngineCallbacks = {
  onPhase?: (phase: Phase) => void;
  onSample?: (s: Sample) => void;
  onPartial?: (partial: Partial<TestResult>) => void;
};

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function meanAbsDelta(xs: number[]): number {
  if (xs.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < xs.length; i++) sum += Math.abs(xs[i] - xs[i - 1]);
  return sum / (xs.length - 1);
}

export async function pingOnce(): Promise<number | null> {
  const t0 = performance.now();
  try {
    await fetch(`${BASE}/__down?bytes=0`, { cache: "no-store" });
    return performance.now() - t0;
  } catch {
    return null;
  }
}

export function bloatGrade(ms: number): TestResult["bufferbloatGrade"] {
  if (ms < 30) return "A";
  if (ms < 60) return "B";
  if (ms < 100) return "C";
  if (ms < 200) return "D";
  return "F";
}

export async function runTest(cfg: TestConfig, cb: EngineCallbacks): Promise<TestResult> {
  const start = performance.now();
  const samples: Sample[] = [];
  let bytesDown = 0;
  let bytesUp = 0;

  const push = (s: Omit<Sample, "t">) => {
    const sample = { ...s, t: performance.now() - start };
    samples.push(sample);
    cb.onSample?.(sample);
  };

  /* ---- Phase 1: idle latency -------------------------------------------- */
  cb.onPhase?.("latency");
  const idleRtts: number[] = [];
  await pingOnce(); // warm up the connection (DNS + TLS), not counted
  for (let i = 0; i < 10; i++) {
    const rtt = await pingOnce();
    if (rtt !== null) {
      idleRtts.push(rtt);
      push({ phase: "latency", rttMs: rtt });
    }
  }
  const idlePingMs = median(idleRtts);
  const idleJitterMs = meanAbsDelta(idleRtts);
  cb.onPartial?.({ idlePingMs, idleJitterMs });

  /* ---- Phase 2: download -------------------------------------------------- */
  cb.onPhase?.("download");
  const dlDuration = cfg.lowData ? 5000 : 9000;
  const dlStreams = (cfg.lowData ? PROFILES.lowData : PROFILES.full).dlStreams;
  const dlChunk = cfg.lowData ? 10_000_000 : 30_000_000;
  const dlCap = cfg.lowData ? 25_000_000 : Infinity;

  const loadedDownRtts: number[] = [];
  const dlResult = await loadPhase({
    duration: dlDuration,
    onRtt: (rtt) => {
      loadedDownRtts.push(rtt);
      push({ phase: "download", rttMs: rtt });
    },
    onThroughput: (mbps) => push({ phase: "download", mbps }),
    run: (signal, countBytes) => {
      const workers: Promise<void>[] = [];
      for (let w = 0; w < dlStreams; w++) {
        workers.push(
          (async () => {
            while (!signal.aborted && bytesDown < dlCap) {
              try {
                const res = await fetch(`${BASE}/__down?bytes=${dlChunk}`, {
                  cache: "no-store",
                  signal,
                });
                const reader = res.body?.getReader();
                if (!reader) break;
                for (;;) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  bytesDown += value.byteLength;
                  countBytes(value.byteLength);
                  if (bytesDown >= dlCap) {
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
    },
  });
  const downloadMbps = dlResult.mbps;
  const loadedDownPingMs = median(loadedDownRtts);
  cb.onPartial?.({ downloadMbps, loadedDownPingMs });

  /* ---- Phase 3: upload ---------------------------------------------------- */
  cb.onPhase?.("upload");
  const ulDuration = cfg.lowData ? 4000 : 7000;
  const ulStreams = (cfg.lowData ? PROFILES.lowData : PROFILES.full).ulStreams;
  const ulChunkSize = cfg.lowData ? 1_000_000 : 2_000_000;
  const ulCap = cfg.lowData ? 8_000_000 : Infinity;
  const ulBody = new Uint8Array(ulChunkSize);
  crypto.getRandomValues(ulBody.subarray(0, 65536)); // partial random is enough (not compressible headers)

  const loadedUpRtts: number[] = [];
  const ulResult = await loadPhase({
    duration: ulDuration,
    onRtt: (rtt) => {
      loadedUpRtts.push(rtt);
      push({ phase: "upload", rttMs: rtt });
    },
    onThroughput: (mbps) => push({ phase: "upload", mbps }),
    run: (signal, countBytes) => {
      const workers: Promise<void>[] = [];
      for (let w = 0; w < ulStreams; w++) {
        workers.push(
          (async () => {
            while (!signal.aborted && bytesUp < ulCap) {
              try {
                await fetch(`${BASE}/__up`, {
                  method: "POST",
                  body: ulBody,
                  cache: "no-store",
                  signal,
                });
                bytesUp += ulChunkSize;
                countBytes(ulChunkSize);
              } catch {
                break;
              }
            }
          })(),
        );
      }
      return Promise.allSettled(workers).then(() => {});
    },
  });
  const uploadMbps = ulResult.mbps;
  const loadedUpPingMs = median(loadedUpRtts);

  /* ---- Scoring ------------------------------------------------------------ */
  const bufferbloatMs = Math.max(
    0,
    Math.max(loadedDownPingMs, loadedUpPingMs) - idlePingMs,
  );

  // Stability: count loaded-latency probes that spiked far beyond idle median.
  const allLoaded = [...loadedDownRtts, ...loadedUpRtts];
  const spikeThreshold = Math.max(idlePingMs * 3, idlePingMs + 150);
  const spikes = allLoaded.filter((r) => r > spikeThreshold).length;

  cb.onPhase?.("done");
  const result: TestResult = {
    timestamp: Date.now(),
    downloadMbps,
    uploadMbps,
    idlePingMs,
    idleJitterMs,
    loadedDownPingMs,
    loadedUpPingMs,
    bufferbloatMs,
    bufferbloatGrade: bloatGrade(bufferbloatMs),
    spikes,
    probeCount: allLoaded.length,
    dataUsedMB: (bytesDown + bytesUp) / 1_000_000,
    durationMs: performance.now() - start,
    lowData: cfg.lowData,
    samples,
  };
  cb.onPartial?.(result);
  return result;
}

/**
 * Runs a traffic generator (`run`) for `duration` ms while sampling
 * throughput every 250ms and probing latency every 600ms.
 * Throughput = trailing-window average, final = median of the top half of
 * samples (ramp-up excluded, matching how real tests report).
 */
async function loadPhase(opts: {
  duration: number;
  run: (signal: AbortSignal, countBytes: (n: number) => void) => Promise<void>;
  onRtt: (rtt: number) => void;
  onThroughput: (mbps: number) => void;
}): Promise<{ mbps: number }> {
  const ctrl = new AbortController();
  let windowBytes = 0;
  const throughputSamples: number[] = [];

  const sampler = setInterval(() => {
    const mbps = (windowBytes * 8) / 250 / 1000; // bytes per 250ms → Mbps
    windowBytes = 0;
    if (mbps > 0) {
      throughputSamples.push(mbps);
      opts.onThroughput(mbps);
    }
  }, 250);

  let pinging = true;
  const pinger = (async () => {
    // Stagger the first probe so it lands mid-load.
    await new Promise((r) => setTimeout(r, 300));
    while (pinging) {
      const rtt = await pingOnce();
      if (rtt !== null && pinging) opts.onRtt(rtt);
      await new Promise((r) => setTimeout(r, 600));
    }
  })();

  const stopper = setTimeout(() => ctrl.abort(), opts.duration);
  await opts.run(ctrl.signal, (n) => {
    windowBytes += n;
  });
  clearTimeout(stopper);
  ctrl.abort();
  clearInterval(sampler);
  pinging = false;
  await pinger;

  // Report the median of the top 50% of samples — ignores TCP ramp-up.
  const sorted = [...throughputSamples].sort((a, b) => a - b);
  const top = sorted.slice(Math.floor(sorted.length / 2));
  return { mbps: median(top) };
}
