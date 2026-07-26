import { measureCapacity } from "./capacityCore";
import type { CapacityPlan, CapacityWorkerRequest, CapacityWorkerResponse } from "./capacityProtocol";
import { MeasurementCancelledError } from "./cancellation";
import { getServer } from "./servers";
import type { DirectionCapacity, StreamDiagnostic } from "./types";

export type CapacityClientOptions = {
  runId: string;
  serverId: string;
  direction: "download" | "upload";
  profileMode: "full" | "lowData" | "quick";
  endpointHealth: CapacityPlan["endpointHealth"];
  profile: {
    ramp: readonly number[];
    maxMs: number;
    maxBytes: number;
    maxRequestBytes: number;
    warmupBytes: number;
    setupTimeoutMs: number;
    stageMinMs: number;
    stageMaxMs: number;
    finalStageMinMs: number;
    stageMinBytes: number;
    minValidSamples: number;
    maxVariationPct: number;
    allowEarlyStatisticalStop: boolean;
  };
  signal?: AbortSignal;
  onProgress?: (mbps: number, streams: number) => void;
  onStage?: (stage: "warmup" | "measurement", streams: number) => void;
  onLatency?: (rttMs: number) => void;
  onBytes?: (bytes: number) => void;
  onDiagnostic?: (diagnostic: StreamDiagnostic) => void;
};

function createPlan(options: CapacityClientOptions): CapacityPlan {
  const server = getServer(options.serverId);
  return {
    runId: options.runId,
    direction: options.direction,
    downloadUrlTemplate: server.downloadUrlTemplate,
    uploadUrl: server.upPath,
    latencyUrl: server.latencyPath,
    endpoint: options.direction === "download"
      ? server.downloadUrlTemplate.replace("?bytes={bytes}", "")
      : server.upPath,
    streamRamp: [...options.profile.ramp],
    maxDurationMs: options.profile.maxMs,
    maxBytes: options.profile.maxBytes,
    maxRequestBytes: options.profile.maxRequestBytes,
    warmupBytes: options.profile.warmupBytes,
    setupTimeoutMs: options.profile.setupTimeoutMs,
    stageMinMs: options.profile.stageMinMs,
    stageMaxMs: options.profile.stageMaxMs,
    finalStageMinMs: options.profile.finalStageMinMs,
    stageMinBytes: options.profile.stageMinBytes,
    minValidSamples: options.profile.minValidSamples,
    maxVariationPct: options.profile.maxVariationPct,
    receiptTolerancePct: 0.5,
    receiptToleranceBytes: 65_536,
    profileMode: options.profileMode,
    endpointHealth: options.endpointHealth,
    allowEarlyStatisticalStop: options.profile.allowEarlyStatisticalStop,
    improvementThresholdPct: 5,
    progressIntervalMs: 100,
    latencyProbeIntervalMs: 500,
  };
}

function logDiagnostic(value: StreamDiagnostic): void {
  if (import.meta.env.DEV && import.meta.env.MODE !== "test" && typeof window !== "undefined") {
    console.debug(`[NetPulse stream diagnostic] ${JSON.stringify(value)}`);
  }
}

export async function measureDirectionCapacity(options: CapacityClientOptions): Promise<DirectionCapacity> {
  const plan = createPlan(options);
  if (typeof Worker === "undefined") {
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      const result = await measureCapacity(plan, {
        onStage: options.onStage,
        onProgress: (mbps, bytes, streams) => {
          options.onProgress?.(mbps, streams);
          options.onBytes?.(bytes);
        },
        onLatency: options.onLatency,
        onDiagnostic: (value) => {
          options.onDiagnostic?.(value);
          logDiagnostic(value);
        },
      }, controller.signal);
      return {
        ...result,
        workerUsed: false,
        reducedConfidenceReasons: [
          ...result.reducedConfidenceReasons,
          "Web Workers were unavailable; measurement shared the main browser event loop.",
        ],
      };
    } finally {
      options.signal?.removeEventListener("abort", abort);
    }
  }

  const id = crypto.randomUUID();
  const worker = new Worker(new URL("../workers/measurement.worker.ts", import.meta.url), { type: "module" });
  return new Promise<DirectionCapacity>((resolve, reject) => {
    let settled = false;
    const finish = () => {
      options.signal?.removeEventListener("abort", cancel);
      worker.terminate();
    };
    const cancel = () => {
      if (settled) return;
      settled = true;
      const message: CapacityWorkerRequest = { type: "cancel", id };
      worker.postMessage(message);
      finish();
      reject(new MeasurementCancelledError());
    };
    options.signal?.addEventListener("abort", cancel, { once: true });
    worker.addEventListener("message", (event: MessageEvent<CapacityWorkerResponse>) => {
      const message = event.data;
      if (message.id !== id || settled) return;
      if (message.type === "progress") {
        options.onProgress?.(message.mbps, message.streams);
        options.onBytes?.(message.bytes);
        return;
      }
      if (message.type === "stage") {
        options.onStage?.(message.stage, message.streams);
        return;
      }
      if (message.type === "latency") {
        options.onLatency?.(message.rttMs);
        return;
      }
      if (message.type === "diagnostic") {
        options.onDiagnostic?.(message.diagnostic);
        logDiagnostic(message.diagnostic);
        return;
      }
      settled = true;
      finish();
      if (message.type === "complete") resolve(message.result);
      else reject(Object.assign(new Error(message.message), { name: message.name }));
    });
    worker.addEventListener("error", (event) => {
      if (settled) return;
      settled = true;
      finish();
      reject(new Error(event.message || "Measurement worker failed."));
    });
    const request: CapacityWorkerRequest = { type: "run", id, plan };
    worker.postMessage(request);
  });
}
