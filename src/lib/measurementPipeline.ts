export const ENGINE_VERSION = "3.1.0";
export const METHODOLOGY_VERSION = "2026.07.21-r2";

export type PipelinePhase =
  | "created"
  | "preflight"
  | "discovering-endpoints"
  | "probing-endpoints"
  | "selecting-endpoint"
  | "collecting-transport-telemetry"
  | "measuring-idle-latency"
  | "warming-up-download"
  | "measuring-download"
  | "measuring-download-loaded-latency"
  | "warming-up-upload"
  | "measuring-upload"
  | "measuring-upload-loaded-latency"
  | "measuring-packet-loss"
  | "analyzing-stability"
  | "verifying-abnormal-results"
  | "calculating-confidence"
  | "completed"
  | "low-confidence"
  | "failed"
  | "cancelled";

export type MeasurementEventKind =
  | "phase-started"
  | "phase-completed"
  | "phase-failed"
  | "phase-retry"
  | "preflight-started"
  | "endpoint-probe"
  | "endpoint-selected"
  | "latency-sample"
  | "download-progress"
  | "download-completed"
  | "upload-progress"
  | "upload-completed"
  | "packet-loss-progress"
  | "verification-started"
  | "confidence-updated"
  | "test-completed"
  | "test-failed"
  | "test-cancelled";

export type MeasurementEventValue = string | number | boolean | null;

export type MeasurementEvent = {
  sequence: number;
  runId: string;
  kind: MeasurementEventKind;
  phase: PipelinePhase;
  timestamp: number;
  elapsedMs: number;
  data: Record<string, MeasurementEventValue>;
};

export type PhaseJournalEntry = {
  phase: PipelinePhase;
  attempt: number;
  status: "running" | "completed" | "failed" | "cancelled";
  startedAt: number;
  endedAt: number | null;
  elapsedStartMs: number;
  durationMs: number | null;
  sampleStartIndex: number;
  sampleEndIndex: number | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export type PhaseToken = { index: number; phase: PipelinePhase };

type RecorderOptions = {
  runId: string;
  startedAt: number;
  monotonicStart: number;
  onBatch?: (events: MeasurementEvent[]) => void;
  flushIntervalMs?: number;
};

/**
 * Retains every raw event immediately while delivering progress to the UI in
 * bounded batches. UI scheduling never controls measurement timing.
 */
export class MeasurementRunRecorder {
  readonly events: MeasurementEvent[] = [];
  readonly phases: PhaseJournalEntry[] = [];

  private readonly attempts = new Map<PipelinePhase, number>();
  private readonly pending: MeasurementEvent[] = [];
  private readonly options: RecorderOptions;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sequence = 0;

  constructor(options: RecorderOptions) {
    this.options = options;
  }

  begin(phase: PipelinePhase, data: Record<string, MeasurementEventValue> = {}): PhaseToken {
    const attempt = (this.attempts.get(phase) ?? 0) + 1;
    this.attempts.set(phase, attempt);
    const elapsedStartMs = this.elapsed();
    const index = this.phases.push({
      phase,
      attempt,
      status: "running",
      startedAt: this.options.startedAt + elapsedStartMs,
      endedAt: null,
      elapsedStartMs,
      durationMs: null,
      sampleStartIndex: this.events.length,
      sampleEndIndex: null,
      errorCode: null,
      errorMessage: null,
    }) - 1;
    this.emit("phase-started", phase, data, true);
    return { index, phase };
  }

  complete(token: PhaseToken, data: Record<string, MeasurementEventValue> = {}): void {
    this.finish(token, "completed", null, data);
  }

  fail(token: PhaseToken, error: unknown, cancelled = false): void {
    const normalized = normalizeError(error);
    this.finish(token, cancelled ? "cancelled" : "failed", normalized, {});
  }

  retry(phase: PipelinePhase, error: unknown): void {
    const normalized = normalizeError(error);
    this.emit("phase-retry", phase, { errorCode: normalized.code, errorMessage: normalized.message }, true);
  }

  emit(
    kind: MeasurementEventKind,
    phase: PipelinePhase,
    data: Record<string, MeasurementEventValue> = {},
    immediate = false,
  ): void {
    const event: MeasurementEvent = {
      sequence: this.sequence++,
      runId: this.options.runId,
      kind,
      phase,
      timestamp: this.options.startedAt + this.elapsed(),
      elapsedMs: this.elapsed(),
      data,
    };
    this.events.push(event);
    this.pending.push(event);
    if (immediate) this.flush();
    else this.scheduleFlush();
  }

  flush(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.pending.length === 0) return;
    const batch = this.pending.splice(0, this.pending.length);
    this.options.onBatch?.(batch);
  }

  dispose(): void {
    this.flush();
  }

  private finish(
    token: PhaseToken,
    status: "completed" | "failed" | "cancelled",
    error: { code: string; message: string } | null,
    data: Record<string, MeasurementEventValue>,
  ): void {
    const entry = this.phases[token.index];
    if (!entry || entry.phase !== token.phase || entry.status !== "running") return;
    const elapsed = this.elapsed();
    entry.status = status;
    entry.endedAt = this.options.startedAt + elapsed;
    entry.durationMs = Math.max(0, elapsed - entry.elapsedStartMs);
    entry.sampleEndIndex = this.events.length;
    entry.errorCode = error?.code ?? null;
    entry.errorMessage = error?.message ?? null;
    this.emit(status === "completed" ? "phase-completed" : "phase-failed", token.phase, {
      ...data,
      durationMs: entry.durationMs,
      errorCode: entry.errorCode,
      errorMessage: entry.errorMessage,
    }, true);
  }

  private elapsed(): number {
    return Math.max(0, performance.now() - this.options.monotonicStart);
  }

  private scheduleFlush(): void {
    if (this.timer !== null || !this.options.onBatch) return;
    this.timer = setTimeout(() => this.flush(), this.options.flushIntervalMs ?? 100);
  }
}

export function createRunId(now = Date.now()): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const suffix = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `np-${now.toString(36)}-${suffix}`;
}

export function errorCode(error: unknown): string {
  return normalizeError(error).code;
}

function normalizeError(error: unknown): { code: string; message: string } {
  if (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError") {
    return { code: "cancelled", message: "Measurement cancelled." };
  }
  if (error instanceof Error) {
    const code = error.name === "MeasurementCancelledError" ? "cancelled" : error.name || "measurement_error";
    return { code: sanitize(code), message: error.message.slice(0, 240) };
  }
  return { code: "measurement_error", message: "Unknown measurement failure." };
}

function sanitize(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9_.-]/g, "_").slice(0, 80);
}
