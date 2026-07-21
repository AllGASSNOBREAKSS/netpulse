import type {
  BlackBoxSample,
  DnsObservation,
  EndpointObservation,
  EndpointResult,
  VisibilityState,
} from "./blackbox";

const PRIMARY_URL = "https://speed.cloudflare.com/__down?bytes=0";
const TRACE_URL = "https://speed.cloudflare.com/cdn-cgi/trace";
const DNS_URL = "https://cloudflare-dns.com/dns-query";
const IPV4_URL = "https://1.1.1.1/cdn-cgi/trace";
const IPV6_URL = "https://[2606:4700:4700::1111]/cdn-cgi/trace";
const PROBE_TIMEOUT_MS = 5_000;

let probeSequence = 0;

export const configuredSecondaryEndpoint = readSecondaryEndpoint();

export type ProbeCollection = {
  sample: BlackBoxSample;
  dns: DnsObservation | null;
  endpoint: EndpointObservation | null;
  bytesReceived: number;
};

export async function collectBlackBoxProbe(options: {
  scheduledAt: number;
  schedulingDelayMs: number;
  visibility: VisibilityState;
  includeDns: boolean;
  includeTrace: boolean;
  secondaryUrl?: string | null;
  signal?: AbortSignal;
}): Promise<ProbeCollection> {
  const startedAt = Date.now();
  const id = nextProbeId(startedAt);
  const secondaryUrl = options.secondaryUrl === undefined ? configuredSecondaryEndpoint : options.secondaryUrl;
  const [primary, secondary, dns, endpoint] = await Promise.all([
    timedEndpoint(PRIMARY_URL, "Primary Cloudflare HTTPS probe", options.signal),
    secondaryUrl
      ? timedEndpoint(secondaryUrl, "Configured independent HTTPS endpoint", options.signal)
      : Promise.resolve(unavailableEndpoint("No independent secondary endpoint is configured.")),
    options.includeDns ? measureDnsTransaction(options.signal) : Promise.resolve(null),
    options.includeTrace ? measureEndpointObservation(options.signal) : Promise.resolve(null),
  ]);
  const completedAt = Date.now();
  const bytesReceived = primary.bytesReceived + secondary.bytesReceived + (dns?.bytesReceived ?? 0) + (endpoint?.bytesReceived ?? 0);
  return {
    sample: {
      id,
      scheduledAt: options.scheduledAt,
      startedAt,
      completedAt,
      schedulingDelayMs: Math.max(0, options.schedulingDelayMs),
      visibility: options.visibility,
      primary,
      secondary,
    },
    dns,
    endpoint,
    bytesReceived,
  };
}

export async function measureDnsTransaction(signal?: AbortSignal): Promise<DnsObservation> {
  const measuredAt = Date.now();
  const nonce = nextProbeId(measuredAt);
  const url = `${DNS_URL}?name=example.com&type=A&ct=application%2Fdns-json&np=${encodeURIComponent(nonce)}`;
  const started = performance.now();
  const result = await fetchBytes(url, {
    headers: { Accept: "application/dns-json" },
    cache: "no-store",
    credentials: "omit",
    referrerPolicy: "no-referrer",
  }, signal);
  const durationMs = performance.now() - started;
  if (!result.ok) {
    return {
      id: `dns-${nonce}`,
      measuredAt,
      status: "failed",
      durationMs: null,
      responseCode: null,
      bytesReceived: result.bytes,
      provider: "Cloudflare DNS over HTTPS",
      detail: result.detail,
    };
  }

  let responseCode: number | null = null;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(result.body));
    if (isRecord(parsed) && typeof parsed.Status === "number") responseCode = parsed.Status;
  } catch {
    return {
      id: `dns-${nonce}`,
      measuredAt,
      status: "failed",
      durationMs,
      responseCode: null,
      bytesReceived: result.bytes,
      provider: "Cloudflare DNS over HTTPS",
      detail: "The controlled DNS-over-HTTPS response was not valid JSON.",
    };
  }

  const ok = responseCode === 0;
  return {
    id: `dns-${nonce}`,
    measuredAt,
    status: ok ? "ok" : "failed",
    durationMs,
    responseCode,
    bytesReceived: result.bytes,
    provider: "Cloudflare DNS over HTTPS",
    detail: ok
      ? "Controlled DNS-over-HTTPS query completed. Timing includes HTTPS transport and is not the operating system resolver's isolated lookup time."
      : `Controlled DNS-over-HTTPS service returned DNS response code ${responseCode ?? "unknown"}.`,
  };
}

export async function measureEndpointObservation(signal?: AbortSignal): Promise<EndpointObservation> {
  const measuredAt = Date.now();
  const [trace, ipv4, ipv6] = await Promise.all([
    fetchBytes(`${TRACE_URL}?np=${encodeURIComponent(nextProbeId(measuredAt))}`, { cache: "no-store" }, signal),
    timedEndpoint(IPV4_URL, "Explicit IPv4 Cloudflare trace endpoint", signal),
    timedEndpoint(IPV6_URL, "Explicit IPv6 Cloudflare trace endpoint", signal),
  ]);
  let edgeCode: string | null = null;
  let observedIpFamily: EndpointObservation["observedIpFamily"] = "unknown";
  if (trace.ok) {
    const fields = parseTrace(new TextDecoder().decode(trace.body));
    edgeCode = fields.colo ?? null;
    const echoedIp = fields.ip ?? "";
    observedIpFamily = echoedIp.includes(":") ? "IPv6" : echoedIp ? "IPv4" : "unknown";
  }
  return {
    id: `endpoint-${nextProbeId(measuredAt)}`,
    measuredAt,
    edgeCode,
    observedIpFamily,
    ipv4,
    ipv6,
    bytesReceived: trace.bytes + ipv4.bytesReceived + ipv6.bytesReceived,
  };
}

async function timedEndpoint(url: string, label: string, signal?: AbortSignal): Promise<EndpointResult> {
  const started = performance.now();
  const result = await fetchBytes(`${url}${url.includes("?") ? "&" : "?"}np=${encodeURIComponent(nextProbeId(Date.now()))}`, {
    cache: "no-store",
    credentials: "omit",
    referrerPolicy: "no-referrer",
  }, signal);
  const durationMs = performance.now() - started;
  return result.ok
    ? { status: "ok", durationMs, bytesReceived: result.bytes, detail: `${label} completed.` }
    : { status: "failed", durationMs: null, bytesReceived: result.bytes, detail: result.detail };
}

function unavailableEndpoint(detail: string): EndpointResult {
  return { status: "unavailable", durationMs: null, bytesReceived: 0, detail };
}

async function fetchBytes(
  url: string,
  init: RequestInit,
  externalSignal?: AbortSignal,
): Promise<{ ok: boolean; bytes: number; body: ArrayBuffer; detail: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  const abort = () => ctrl.abort();
  externalSignal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(url, { ...init, signal: ctrl.signal });
    if (!response.ok) {
      return { ok: false, bytes: 0, body: new ArrayBuffer(0), detail: `HTTPS endpoint returned status ${response.status}.` };
    }
    const body = await response.arrayBuffer();
    return { ok: true, bytes: body.byteLength, body, detail: "HTTPS request completed." };
  } catch (error) {
    const detail = ctrl.signal.aborted
      ? externalSignal?.aborted ? "Monitoring probe was canceled." : "Monitoring probe timed out."
      : error instanceof Error ? `Monitoring probe failed: ${error.message}` : "Monitoring probe failed.";
    return { ok: false, bytes: 0, body: new ArrayBuffer(0), detail };
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", abort);
  }
}

function parseTrace(text: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of text.trim().split("\n")) {
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    fields[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return fields;
}

function nextProbeId(timestamp: number): string {
  probeSequence = (probeSequence + 1) % Number.MAX_SAFE_INTEGER;
  return `${timestamp.toString(36)}-${probeSequence.toString(36)}`;
}

function readSecondaryEndpoint(): string | null {
  const value = import.meta.env.VITE_MONITOR_SECONDARY_URL;
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
