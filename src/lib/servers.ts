/**
 * Server registry, probing, selection, and network metadata.
 *
 * Honesty note: a browser can only reach measurement endpoints that serve
 * permissive CORS headers and support no-store streaming downloads plus POST
 * uploads. Cloudflare's speed endpoint is the one production-grade provider
 * that does all of this, and it is anycast — you are routed to the nearest of
 * Cloudflare's edge locations ("colo"). The registry and ranking below are
 * genuinely multi-server; today one provider is registered, and the UI states
 * that plainly rather than inventing peers.
 *
 * Real network metadata (ISP, ASN, client + server geo, distance) comes from
 * Cloudflare's `/meta` endpoint — the same source speed.cloudflare.com uses.
 */
import { summarize } from "./stats";
import type { ServerProbe, ServerSelection } from "./types";

export type ServerCandidate = {
  id: string;
  provider: string;
  base: string;
  downPath: (bytes: number) => string;
  upPath: string;
  tracePath: string;
  metaPath: string;
  protocol: string;
  /** The server operator's own ASN — factual reference data, not measured. */
  asn: string;
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
    metaPath: "https://speed.cloudflare.com/meta",
    protocol: "HTTPS (fetch, anycast)",
    asn: "AS13335 Cloudflare",
    throughput: true,
  },
];

export function getServer(id: string | undefined): ServerCandidate {
  return SERVERS.find((s) => s.id === id) ?? SERVERS[0];
}

/** Great-circle distance in km between two [lat, lon] points. */
export function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const lat1 = (a[0] * Math.PI) / 180;
  const lat2 = (b[0] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/* ---- Network metadata (real, from /meta) ---------------------------------- */
export type NetworkMeta = {
  clientIp: string;
  ipFamily: "IPv4" | "IPv6" | "unknown";
  asn: number | null;
  org: string | null; // the actual ISP name, e.g. "Optimum Online"
  city: string | null;
  region: string | null;
  country: string | null;
  clientLat: number | null;
  clientLon: number | null;
  colo: string | null; // server IATA code, e.g. "EWR"
  coloCity: string | null;
  coloLat: number | null;
  coloLon: number | null;
};

export async function fetchMeta(serverId: string | undefined): Promise<NetworkMeta | null> {
  try {
    const j = await (await fetch(getServer(serverId).metaPath, { cache: "no-store" })).json();
    const ip: string = j.clientIp ?? "";
    const colo = j.colo ?? {};
    return {
      clientIp: ip,
      ipFamily: ip.includes(":") ? "IPv6" : ip ? "IPv4" : "unknown",
      asn: typeof j.asn === "number" ? j.asn : null,
      org: j.asOrganization ?? null,
      city: j.city ?? null,
      region: j.region ?? null,
      country: j.country ?? null,
      clientLat: numOrNull(j.latitude),
      clientLon: numOrNull(j.longitude),
      colo: colo.iata ?? null,
      coloCity: colo.city ?? null,
      coloLat: numOrNull(colo.lat),
      coloLon: numOrNull(colo.lon),
    };
  } catch {
    return null;
  }
}

/** Real client↔colo distance when both coordinates are present, else null. */
export function coloDistanceKm(m: NetworkMeta | null): number | null {
  if (!m || m.clientLat == null || m.clientLon == null || m.coloLat == null || m.coloLon == null) return null;
  return haversineKm([m.clientLat, m.clientLon], [m.coloLat, m.coloLon]);
}

function numOrNull(v: unknown): number | null {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

/* ---- Probing + selection -------------------------------------------------- */
async function pingServer(c: ServerCandidate): Promise<number | null> {
  const t0 = performance.now();
  try {
    const res = await fetch(c.downPath(0), { cache: "no-store" });
    if (!res.ok) return null;
    await res.arrayBuffer();
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

async function probeCandidate(c: ServerCandidate, samples: number): Promise<ServerProbe> {
  const trace = await fetchTrace(c);
  await pingServer(c); // warm-up, discarded
  const rtts: number[] = [];
  let failed = 0;
  for (let i = 0; i < samples; i++) {
    const rtt = await pingServer(c);
    if (rtt === null) failed++;
    else rtts.push(rtt);
  }
  const ip = trace?.ip ?? "";
  const ipFamily: ServerProbe["ipFamily"] = ip.includes(":") ? "IPv6" : ip ? "IPv4" : "unknown";
  return {
    id: c.id,
    provider: c.provider,
    city: trace?.colo ?? null, // server colo code; enriched with distance/geo later
    region: null,
    approxDistanceKm: null, // set from /meta after selection (real client↔colo)
    asn: c.asn,
    protocol: c.protocol,
    ipFamily,
    latency: summarize(rtts),
    available: rtts.length > 0,
    rank: 0,
  };
}

/** Rank = availability × latency × consistency. Unavailable → 0. */
export function rankProbes(probes: ServerProbe[]): ServerProbe[] {
  const avail = probes.filter((p) => p.available);
  const bestMed = Math.min(...avail.map((p) => p.latency.median), Infinity);
  return probes
    .map((p) => {
      if (!p.available) return { ...p, rank: 0 };
      const latScore = bestMed / Math.max(p.latency.median, 1);
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
