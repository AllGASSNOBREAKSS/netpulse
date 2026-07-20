/**
 * Latency probing. A single zero-byte download is used as the round-trip
 * probe; timing is performance.now() (monotonic, sub-ms). HTTP round-trips
 * sit slightly above raw ICMP — documented in the methodology panel.
 */
import { getServer } from "./servers";

const PROBE_TIMEOUT_MS = 5000;

/** One latency probe against the active (or given) server. */
export async function pingOnce(serverId?: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<number | null> {
  const server = getServer(serverId);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = performance.now();
  try {
    const res = await fetch(server.downPath(0), { cache: "no-store", signal: ctrl.signal });
    if (!res.ok) return null;
    // Drain the (empty) body so timing reflects a complete round-trip.
    await res.arrayBuffer();
    return performance.now() - t0;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Idle latency: `count` sequential probes after a warm-up. Returns raw RTTs
 * plus the number that failed, for min/median/mean/p95/p99/jitter downstream.
 */
export async function measureIdleLatency(
  count: number,
  serverId: string | undefined,
  onProbe?: (rtt: number) => void,
): Promise<{ rtts: number[]; failed: number }> {
  await pingOnce(serverId); // warm connection, discard
  const rtts: number[] = [];
  let failed = 0;
  for (let i = 0; i < count; i++) {
    const rtt = await pingOnce(serverId);
    if (rtt === null) failed++;
    else {
      rtts.push(rtt);
      onProbe?.(rtt);
    }
  }
  return { rtts, failed };
}
