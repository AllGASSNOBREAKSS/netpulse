import { throwIfCancelled } from "./cancellation";
import { downloadPhase } from "./throughput";
import type { SecondaryVerification, ServerSelection, ThroughputStats } from "./types";

const AGREEMENT_THRESHOLD_PCT = 25;

export type SecondaryVerificationResult = {
  verification: SecondaryVerification;
  throughput: ThroughputStats | null;
};

/** Run a bounded independent download only when a probed backup exists. */
export async function verifySecondaryDownload(input: {
  server: ServerSelection;
  primaryMbps: number;
  lowData: boolean;
  signal?: AbortSignal;
  onBytes?: (bytes: number) => void;
}): Promise<SecondaryVerificationResult> {
  const backup = input.server.backups[0];
  if (!backup) return { verification: unavailableSecondary(input.primaryMbps), throughput: null };

  try {
    const throughput = await downloadPhase({
      serverId: backup.id,
      streams: input.lowData ? 1 : 2,
      minDurationMs: input.lowData ? 700 : 1_000,
      maxDurationMs: input.lowData ? 1_400 : 2_200,
      maxBytes: input.lowData ? 4_000_000 : 10_000_000,
      chunkBytes: input.lowData ? 2_000_000 : 4_000_000,
      onBytes: input.onBytes,
      signal: input.signal,
    });
    const differencePct = Math.abs(throughput.mbps - input.primaryMbps) / Math.max(input.primaryMbps, 0.001) * 100;
    const status: SecondaryVerification["status"] = differencePct <= AGREEMENT_THRESHOLD_PCT ? "agree" : "disagree";
    return {
      throughput,
      verification: {
        status,
        endpointId: backup.id,
        endpointLabel: `${backup.regionLabel} (${backup.provider})`,
        primaryMbps: input.primaryMbps,
        secondaryMbps: throughput.mbps,
        differencePct,
        bytesTransferred: throughput.bytes + throughput.warmupBytes,
        durationMs: throughput.durationMs,
        streams: throughput.streams,
        method: "lightweight-download",
        reason: status === "agree"
          ? `A bounded independent download measured ${throughput.mbps.toFixed(1)} Mbps, within ${AGREEMENT_THRESHOLD_PCT}% of the primary result.`
          : `A bounded independent download measured ${throughput.mbps.toFixed(1)} Mbps, ${differencePct.toFixed(1)}% from the primary result. The endpoints disagree; NetPulse does not average them or silently replace the primary result.`,
      },
    };
  } catch (error) {
    throwIfCancelled(input.signal);
    const detail = error instanceof Error ? error.message.slice(0, 160) : "unknown verification failure";
    return {
      throughput: null,
      verification: {
        ...latencyOnlySecondary(input.server, input.primaryMbps),
        reason: `The backup passed endpoint probing, but its bounded throughput verification failed (${detail}). Only latency reachability is retained.`,
      },
    };
  }
}

export function latencyOnlySecondary(server: ServerSelection, primaryMbps: number): SecondaryVerification {
  const backup = server.backups[0];
  if (!backup) return unavailableSecondary(primaryMbps);
  return {
    status: "latency-only",
    endpointId: backup.id,
    endpointLabel: `${backup.regionLabel} (${backup.provider})`,
    primaryMbps,
    secondaryMbps: null,
    differencePct: null,
    bytesTransferred: 0,
    durationMs: null,
    streams: null,
    method: "latency-only",
    reason: `The backup passed ${backup.attempted - backup.failed}/${backup.attempted} HTTPS route probes at ${Math.round(backup.latency.median)} ms median. Throughput agreement remains unverified.`,
  };
}

export function unavailableSecondary(primaryMbps: number): SecondaryVerification {
  return {
    status: "unavailable",
    endpointId: null,
    endpointLabel: null,
    primaryMbps,
    secondaryMbps: null,
    differencePct: null,
    bytesTransferred: 0,
    durationMs: null,
    streams: null,
    method: "unavailable",
    reason: "No independently reachable compatible backup endpoint was available; no cross-server throughput claim is made.",
  };
}
