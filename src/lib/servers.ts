/**
 * Server registry, probing, and selection.
 *
 * Honesty note: a browser can only reach measurement endpoints that serve
 * permissive CORS headers and support no-store range/stream downloads plus
 * POST uploads. Cloudflare's speed endpoint is the one production-grade
 * provider that does all of this, and it is anycast — you are automatically
 * routed to the nearest of Cloudflare's 300+ edge locations ("colo"). The
 * registry and ranking below are genuinely multi-server; today one provider
 * is registered, and the UI states that plainly rather than inventing peers.
 */
import { summarize } from "./stats";
import type { ServerProbe, ServerSelection } from "./types";

export type ServerCandidate = {
  id: string;
  provider: string;
  /** Base origin for down/up/trace. */
  base: string;
  downPath: (bytes: number) => string;
  upPath: string;
  tracePath: string;
  protocol: string;
  /** Full throughput protocol supported (down + up), vs latency-only. */
  throughput: boolean;
};

export const SERVERS: ServerCandidate[] = [
  {
    id: "cloudflare",
    provider: "Cloudflare",
    base: "https://speed.cloudflare.com",
    downPath: (bytes) => `https://speed.cloudflare.com/__down?bytes=${bytes}`,
    upPath: "https://speed.cloudflare.com/__up",
    tracePath: "https://speed.cloudflare.com/cdn-cgi/trace",
    protocol: "HTTPS (fetch, anycast)",
    throughput: true,
  },
];

export function getServer(id: string | undefined): ServerCandidate {
  return SERVERS.find((s) => s.id === id) ?? SERVERS[0];
}

async function pingServer(c: ServerCandidate): Promise<number | null> {
  const t0 = performance.now();
  try {
    const res = await fetch(c.downPath(0), { cache: "no-store" });
    if (!res.ok) return null;
    return performance.now() - t0;
  } catch {
    return null;
  }
}

type TraceInfo = Record<string, string>;

async function fetchTrace(c: ServerCandidate): Promise<TraceInfo | null> {
  try {
    const t = await (await fetch(c.tracePath, { cache: "no-store" })).text();
    const info: TraceInfo = {};
    for (const line of t.trim().split("\n")) {
      const [k, v] = line.split("=");
      if (k && v) info[k] = v;
    }
    return info;
  } catch {
    return null;
  }
}

/**
 * Probe one candidate: N latency samples + trace metadata. `clientLoc` is the
 * caller's [lat,lon] parsed from the trace `loc`/geo when available so distance
 * is a real estimate, not a guess.
 */
async function probeCandidate(c: ServerCandidate, samples: number): Promise<ServerProbe> {
  const trace = await fetchTrace(c);
  await pingServer(c); // warm-up (DNS/TLS), discarded
  const rtts: number[] = [];
  let failed = 0;
  for (let i = 0; i < samples; i++) {
    const rtt = await pingServer(c);
    if (rtt === null) failed++;
    else rtts.push(rtt);
  }
  const latency = summarize(rtts);
  const ip = trace?.ip ?? "";
  const ipFamily: ServerProbe["ipFamily"] = ip.includes(":") ? "IPv6" : ip ? "IPv4" : "unknown";

  // Cloudflare exposes the serving colo code and the client's country code,
  // but not client coordinates. A meaningful client-to-edge distance cannot
  // be derived from those facts alone, so it remains unavailable.
  const approxDistanceKm = null;

  return {
    id: c.id,
    provider: c.provider,
    city: trace?.colo ?? null,
    region: trace?.loc ?? null,
    approxDistanceKm,
    asn: null,
    protocol: c.protocol,
    ipFamily,
    latency,
    available: rtts.length > 0,
    attempted: samples,
    failed,
    availability: samples > 0 ? rtts.length / samples : 0,
    rank: 0,
  };
}

/**
 * Rank = reachability × latency × consistency. Lower median latency, lower
 * jitter, and a higher successful-probe ratio rank higher; unavailable servers
 * rank 0. This prevents a candidate with one lucky success from outranking a
 * consistently reachable server.
 */
export function rankProbes(probes: ServerProbe[]): ServerProbe[] {
  const avail = probes.filter((p) => p.available);
  const bestMed = Math.min(...avail.map((p) => p.latency.median), Infinity);
  return probes
    .map((p) => {
      if (!p.available) return { ...p, rank: 0 };
      const latScore = bestMed / Math.max(p.latency.median, 1); // 1.0 for the fastest
      const jitScore = 1 / (1 + p.latency.jitter / 10);
      const reachability = Math.max(0, Math.min(1, p.availability));
      return { ...p, rank: Math.round((latScore * 0.7 + jitScore * 0.3) * reachability * 100) / 100 };
    })
    .sort((a, b) => b.rank - a.rank);
}

export async function selectServer(
  probesPerServer: number,
  manualId: string | undefined,
): Promise<ServerSelection> {
  const probes = rankProbes(await Promise.all(SERVERS.map((c) => probeCandidate(c, probesPerServer))));

  let chosen: ServerProbe;
  let manual = false;
  let reason: string;

  if (manualId && probes.some((p) => p.id === manualId && p.available)) {
    chosen = probes.find((p) => p.id === manualId)!;
    manual = true;
    reason = `Manually selected ${chosen.provider}.`;
  } else {
    const available = probes.filter((p) => p.available);
    chosen = available[0] ?? probes[0];
    reason =
      available.length <= 1
        ? `${chosen.provider} (only reachable candidate). Anycast routed you to colo ${chosen.city ?? "?"} at ${Math.round(chosen.latency.median)} ms median latency.`
        : `Lowest latency (${Math.round(chosen.latency.median)} ms median) and steadiest of ${available.length} reachable candidates.`;
  }

  return { chosen, candidates: probes, reason, manual };
}
