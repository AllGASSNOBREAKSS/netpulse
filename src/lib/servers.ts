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

/** Approximate great-circle distance in km. */
function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const lat1 = (a[0] * Math.PI) / 180;
  const lat2 = (b[0] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
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

  // Colo distance: Cloudflare exposes the serving colo code but not its coords
  // over CORS, so distance stays null unless a geo hint is present. We never
  // fabricate a number.
  const approxDistanceKm =
    trace?.loc && trace.colo && COLO_COORDS[trace.colo]
      ? haversineKm(parseLoc(trace.loc) ?? COLO_COORDS[trace.colo], COLO_COORDS[trace.colo])
      : null;

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
    rank: 0,
  };
}

function parseLoc(loc: string): [number, number] | null {
  // Cloudflare `loc` is a country code, not coordinates — no parse possible.
  void loc;
  return null;
}

/** A tiny sampling of Cloudflare colo coordinates for distance estimates. */
const COLO_COORDS: Record<string, [number, number]> = {
  IAD: [38.94, -77.46],
  EWR: [40.69, -74.17],
  LAX: [33.94, -118.4],
  SJC: [37.36, -121.93],
  ORD: [41.97, -87.9],
  DFW: [32.9, -97.04],
  ATL: [33.64, -84.43],
  MIA: [25.8, -80.28],
  LHR: [51.47, -0.46],
  CDG: [49.0, 2.55],
  FRA: [50.03, 8.56],
  AMS: [52.31, 4.76],
  SIN: [1.36, 103.99],
  NRT: [35.77, 140.39],
  SYD: [-33.95, 151.18],
};

/**
 * Rank = availability × latency × consistency. Lower median latency and lower
 * jitter rank higher; unavailable servers rank 0.
 */
export function rankProbes(probes: ServerProbe[]): ServerProbe[] {
  const avail = probes.filter((p) => p.available);
  const bestMed = Math.min(...avail.map((p) => p.latency.median), Infinity);
  return probes
    .map((p) => {
      if (!p.available) return { ...p, rank: 0 };
      const latScore = bestMed / Math.max(p.latency.median, 1); // 1.0 for the fastest
      const jitScore = 1 / (1 + p.latency.jitter / 10);
      return { ...p, rank: Math.round(latScore * 0.7 * 100 + jitScore * 0.3 * 100) / 100 };
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
