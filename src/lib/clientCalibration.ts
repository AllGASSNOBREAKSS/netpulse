export type ClientCalibration = {
  workerSupported: boolean;
  hardwareConcurrency: number | null;
  timerResolutionMs: number | null;
  bufferGenerationMbps: number | null;
  tabForeground: boolean;
  likelyClientLimited: boolean;
  warnings: string[];
};

const CALIBRATION_BYTES = 1_000_000;

/** Lightweight, measured client capability check performed before network load. */
export function calibrateClient(): ClientCalibration {
  const hardwareConcurrency = finitePositive(navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : null;
  const timerResolutionMs = measureTimerResolution();
  const bufferGenerationMbps = measureBufferGeneration();
  const tabForeground = typeof document === "undefined" || document.visibilityState === "visible";
  const workerSupported = typeof Worker !== "undefined";
  const warnings: string[] = [];

  if (!workerSupported) warnings.push("Web Workers are unavailable; measurement and presentation share the main browser process.");
  if (hardwareConcurrency !== null && hardwareConcurrency <= 2) warnings.push("The browser reports two or fewer logical processors.");
  if (timerResolutionMs !== null && timerResolutionMs > 2) warnings.push(`Monotonic timer resolution is coarse (${timerResolutionMs.toFixed(2)} ms).`);
  if (bufferGenerationMbps !== null && bufferGenerationMbps < 100) warnings.push(`In-memory payload generation was limited (${bufferGenerationMbps.toFixed(0)} Mbps equivalent).`);
  if (!tabForeground) warnings.push("The tab was already backgrounded during calibration.");

  return {
    workerSupported,
    hardwareConcurrency,
    timerResolutionMs,
    bufferGenerationMbps,
    tabForeground,
    likelyClientLimited: warnings.length > 0,
    warnings,
  };
}

function measureTimerResolution(): number | null {
  let previous = performance.now();
  let smallest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < 2_000; index += 1) {
    const current = performance.now();
    const delta = current - previous;
    if (delta > 0) smallest = Math.min(smallest, delta);
    previous = current;
  }
  return Number.isFinite(smallest) ? smallest : null;
}

function measureBufferGeneration(): number | null {
  if (!globalThis.crypto?.getRandomValues) return null;
  const bytes = new Uint8Array(CALIBRATION_BYTES);
  const started = performance.now();
  for (let offset = 0; offset < bytes.length; offset += 65_536) {
    crypto.getRandomValues(bytes.subarray(offset, Math.min(offset + 65_536, bytes.length)));
  }
  const durationMs = performance.now() - started;
  return durationMs > 0 ? (CALIBRATION_BYTES * 8) / durationMs / 1000 : null;
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
