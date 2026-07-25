/**
 * Statistics helpers shared across the measurement pipeline.
 *
 * All functions are pure and operate on plain number arrays so they can be
 * unit-tested with synthetic fixtures (see src/lib/__tests__). Timing values
 * are expected to come from performance.now() (monotonic, sub-ms).
 */

export function min(xs: number[]): number {
  return xs.length ? Math.min(...xs) : 0;
}

export function max(xs: number[]): number {
  return xs.length ? Math.max(...xs) : 0;
}

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function median(xs: number[]): number {
  return percentile(xs, 50);
}

/** Mean of samples from the 25th through 75th percentile (inclusive). */
export function interquartileMean(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const low = percentile(sorted, 25);
  const high = percentile(sorted, 75);
  const middle = sorted.filter((value) => value >= low && value <= high);
  return mean(middle.length ? middle : sorted);
}

/**
 * Percentile with linear interpolation between closest ranks.
 * `p` is 0–100. percentile(xs, 95) == P95.
 */
export function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  if (xs.length === 1) return xs[0];
  const s = [...xs].sort((a, b) => a - b);
  const idx = (p / 100) * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

export function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance = xs.reduce((sum, x) => sum + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

/**
 * Jitter as the mean absolute difference between consecutive samples.
 * This is the IPD (inter-packet delay variation) approximation used by most
 * consumer speed tests — simple, order-sensitive, and easy to explain.
 */
export function jitter(xs: number[]): number {
  if (xs.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < xs.length; i++) sum += Math.abs(xs[i] - xs[i - 1]);
  return sum / (xs.length - 1);
}

/** Coefficient of variation (stddev / mean). Unitless spread measure. */
export function coefficientOfVariation(xs: number[]): number {
  const m = mean(xs);
  if (m === 0) return 0;
  return stddev(xs) / m;
}

export type Summary = {
  min: number;
  median: number;
  mean: number;
  interquartileMean: number;
  p90: number;
  p95: number;
  p99: number;
  jitter: number;
  stddev: number;
  count: number;
};

/** Full descriptive summary of a latency (or any) sample set. */
export function summarize(xs: number[]): Summary {
  return {
    min: min(xs),
    median: median(xs),
    mean: mean(xs),
    interquartileMean: interquartileMean(xs),
    p90: percentile(xs, 90),
    p95: percentile(xs, 95),
    p99: percentile(xs, 99),
    jitter: jitter(xs),
    stddev: stddev(xs),
    count: xs.length,
  };
}
