import { linkAbortSignal, throwIfCancelled } from "./cancellation";
import { getServer } from "./servers";
import type { TransportTelemetry } from "./types";

const TIMEOUT_MS = 4_000;

/**
 * Collect transport facts exposed by the browser and optional NetPulse server
 * response headers. Missing TCP_INFO/QUIC telemetry remains null; it is never
 * inferred from throughput or latency.
 */
export async function collectTransportTelemetry(serverId: string, signal?: AbortSignal): Promise<TransportTelemetry> {
  const server = getServer(serverId);
  const controller = new AbortController();
  const unlink = linkAbortSignal(controller, signal);
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(withCacheBuster(server.latencyPath), { cache: "no-store", signal: controller.signal });
    if (!response.ok) return unavailable(`Transport probe returned HTTP ${response.status}.`);
    await response.arrayBuffer();
    const browserProtocol = findBrowserProtocol(response.url || server.latencyPath);
    const transportHeader = response.headers.get("x-netpulse-transport")?.toLowerCase();
    const serverTransport = transportHeader === "tcp" || transportHeader === "quic" ? transportHeader : "unknown";
    const tcpRtt = boundedHeader(response.headers.get("x-netpulse-tcp-rtt-ms"), 0, 60_000);
    const quicRtt = boundedHeader(response.headers.get("x-netpulse-quic-rtt-ms"), 0, 60_000);
    const retransmits = boundedHeader(response.headers.get("x-netpulse-retransmits"), 0, 1_000_000, true);
    const serverTiming = response.headers.get("server-timing");
    const hasTransportHeaders = serverTransport !== "unknown" || tcpRtt !== null || quicRtt !== null || retransmits !== null;
    const hasServerHeaders = hasTransportHeaders || serverTiming !== null;
    const source: TransportTelemetry["source"] = hasServerHeaders && browserProtocol
      ? "combined"
      : hasServerHeaders
        ? "server-headers"
        : browserProtocol
          ? "browser-resource-timing"
          : "unavailable";
    return {
      browserProtocol,
      serverTransport,
      serverReportedTcpRttMs: tcpRtt,
      serverReportedQuicRttMs: quicRtt,
      serverReportedRetransmits: retransmits,
      serverTiming,
      source,
      reason: hasTransportHeaders
        ? "Transport values came from explicitly exposed NetPulse response headers; browser protocol came from Resource Timing when available."
        : serverTiming !== null && browserProtocol
          ? "The browser protocol and a generic Server-Timing header were exposed, but server TCP/QUIC RTT and retransmit telemetry were unavailable."
          : serverTiming !== null
            ? "A generic Server-Timing header was exposed, but browser protocol and server TCP/QUIC RTT and retransmit telemetry were unavailable."
        : browserProtocol
          ? "Only the browser's negotiated application protocol was exposed. Server TCP/QUIC RTT and retransmit telemetry were unavailable."
          : "Neither browser Resource Timing nor server-exposed TCP/QUIC telemetry was available for this endpoint.",
    };
  } catch {
    throwIfCancelled(signal);
    return unavailable("Transport telemetry probe was blocked, timed out, or unavailable.");
  } finally {
    clearTimeout(timer);
    unlink();
  }
}

function findBrowserProtocol(url: string): string | null {
  if (typeof performance === "undefined" || typeof performance.getEntriesByType !== "function") return null;
  let target: URL;
  try {
    target = new URL(url, typeof location === "undefined" ? "https://netpulse.invalid" : location.origin);
  } catch {
    return null;
  }
  const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    try {
      const candidate = new URL(entry.name);
      if (candidate.origin === target.origin && candidate.pathname === target.pathname && entry.nextHopProtocol) return entry.nextHopProtocol;
    } catch {
      continue;
    }
  }
  return null;
}

function boundedHeader(value: string | null, min: number, max: number, integer = false): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max || integer && !Number.isInteger(parsed)) return null;
  return parsed;
}

function unavailable(reason: string): TransportTelemetry {
  return {
    browserProtocol: null,
    serverTransport: "unknown",
    serverReportedTcpRttMs: null,
    serverReportedQuicRttMs: null,
    serverReportedRetransmits: null,
    serverTiming: null,
    source: "unavailable",
    reason,
  };
}

function withCacheBuster(url: string): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}np_transport=${Math.round(performance.now())}`;
}
