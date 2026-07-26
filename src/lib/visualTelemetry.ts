import { median } from "./stats";

export type VisualTelemetryOptions = {
  windowMs?: number;
  emitIntervalMs?: number;
  smoothing?: number;
};

/**
 * Produces a presentation-only target from real throughput samples.
 * Measurement samples and publication calculations never consume this value.
 */
export class VisualTelemetry {
  private readonly windowMs: number;
  private readonly emitIntervalMs: number;
  private readonly smoothing: number;
  private readonly minimumSpanMs = 150;
  private samples: Array<{ atMs: number; mbps: number }> = [];
  private lastEmitAtMs = Number.NEGATIVE_INFINITY;
  private current: number | null = null;

  constructor(options: VisualTelemetryOptions = {}) {
    this.windowMs = options.windowMs ?? 1_000;
    this.emitIntervalMs = options.emitIntervalMs ?? 225;
    this.smoothing = options.smoothing ?? 0.45;
  }

  push(mbps: number, atMs: number): number | null {
    if (!Number.isFinite(mbps) || mbps < 0 || !Number.isFinite(atMs)) return null;
    this.samples.push({ atMs, mbps });
    this.samples = this.samples.filter((sample) => sample.atMs >= atMs - this.windowMs);
    if (this.samples.length < 2 || atMs - this.samples[0].atMs < this.minimumSpanMs) return null;
    if (atMs - this.lastEmitAtMs < this.emitIntervalMs) return null;
    const center = median(this.samples.map((sample) => sample.mbps));
    this.current = this.current === null ? center : this.current + (center - this.current) * this.smoothing;
    this.lastEmitAtMs = atMs;
    return this.current;
  }

  reset(): void {
    this.samples = [];
    this.lastEmitAtMs = Number.NEGATIVE_INFINITY;
    this.current = null;
  }
}
