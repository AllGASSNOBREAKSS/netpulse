/**
 * Latency probing. A single zero-byte download is used as the round-trip
 * probe; timing is performance.now() (monotonic, sub-ms). HTTP round-trips
 * sit slightly above raw ICMP — documented in the methodology panel.
 */
import { getServer } from "./servers";

/** One latency probe against the active (or given) server. */
export async function pingOnce(serverId?: string): Promise<number | null> {
  const server = getServer(serverId);
  const t0 = performance.now();
  try {
    const res = await fetch(server.downPath(0), { cache: "no-store" });
    if (!res.ok) return null;
    // Drain the (empty) body so timing reflects a complete round-trip.
    await res.arrayBuffer();
    return performance.now() - t0;
  } catch {
    return null;
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
