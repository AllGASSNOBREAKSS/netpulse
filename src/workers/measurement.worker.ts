/// <reference lib="webworker" />

import { measureCapacity } from "../lib/capacityCore";
import type { CapacityWorkerRequest, CapacityWorkerResponse } from "../lib/capacityProtocol";

const scope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;
const controllers = new Map<string, AbortController>();

function post(message: CapacityWorkerResponse): void {
  scope.postMessage(message);
}

scope.addEventListener("message", (event: MessageEvent<CapacityWorkerRequest>) => {
  const message = event.data;
  if (message.type === "cancel") {
    controllers.get(message.id)?.abort(new DOMException("Measurement cancelled.", "AbortError"));
    return;
  }

  const controller = new AbortController();
  controllers.set(message.id, controller);
  void measureCapacity(message.plan, {
    onStage: (stage, streams) => post({ type: "stage", id: message.id, stage, streams }),
    onProgress: (mbps, bytes, streams) => post({ type: "progress", id: message.id, mbps, bytes, streams }),
    onLatency: (rttMs) => post({ type: "latency", id: message.id, rttMs }),
    onDiagnostic: (diagnostic) => post({ type: "diagnostic", id: message.id, diagnostic }),
  }, controller.signal)
    .then((result) => post({ type: "complete", id: message.id, result }))
    .catch((error: unknown) => post({
      type: "error",
      id: message.id,
      name: error instanceof Error ? error.name : "MeasurementError",
      message: error instanceof Error ? error.message.slice(0, 240) : "Unknown measurement worker failure.",
    }))
    .finally(() => controllers.delete(message.id));
});

export {};
