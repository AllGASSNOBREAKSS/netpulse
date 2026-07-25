export class MeasurementCancelledError extends Error {
  constructor(message = "Measurement cancelled.") {
    super(message);
    this.name = "MeasurementCancelledError";
  }
}

export function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new MeasurementCancelledError();
}

export function linkAbortSignal(controller: AbortController, signal?: AbortSignal): () => void {
  if (!signal) return () => undefined;
  const abort = () => controller.abort(signal.reason);
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  return () => signal.removeEventListener("abort", abort);
}

export function isCancellation(error: unknown): boolean {
  return error instanceof MeasurementCancelledError || (
    typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError"
  );
}
