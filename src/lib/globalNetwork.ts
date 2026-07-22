export const ENDPOINT_DIRECTORY_SCHEMA_VERSION = 1;
export const MEASUREMENT_PROTOCOL_VERSION = 1;

export type CoverageStatus = "supported" | "pilot" | "planned" | "unsupported";
export type EndpointStatus = "active" | "pilot" | "draining" | "disabled";
export type EndpointHealthStatus = "healthy" | "degraded" | "draining" | "unavailable" | "unknown";

export type RegionalCoverage = {
  id: string;
  label: string;
  status: CoverageStatus;
  note: string;
};

export type EndpointCapabilities = {
  download: boolean;
  upload: boolean;
  latency: boolean;
  echo: boolean;
  ipv4: boolean;
  ipv6: boolean;
  health: boolean;
  capacity: boolean;
  version: boolean;
};

export type EndpointDirectoryEntry = {
  id: string;
  provider: string;
  regionId: string;
  regionLabel: string;
  city: string | null;
  countryCode: string | null;
  status: EndpointStatus;
  protocol: string;
  protocolVersion: number | null;
  downloadUrlTemplate: string;
  uploadUrl: string;
  latencyUrl: string;
  traceUrl: string | null;
  healthUrl: string | null;
  echoUrl: string | null;
  capabilities: EndpointCapabilities;
};

export type EndpointDirectory = {
  schemaVersion: number;
  revision: string;
  publishedAt: string;
  coverage: RegionalCoverage[];
  endpoints: EndpointDirectoryEntry[];
};

export type EndpointHealth = {
  status: EndpointHealthStatus;
  checkedAt: string | null;
  expiresAt: string | null;
  loadPct: number | null;
  capacityMbps: number | null;
  availableCapacityMbps: number | null;
  activeTests: number | null;
  maxConcurrentTests: number | null;
  serverVersion: string | null;
  protocolVersion: number | null;
  reason: string;
};

export type DirectoryLoadResult = {
  directory: EndpointDirectory;
  source: "network-directory" | "built-in-fallback";
  warning: string | null;
};

const REQUEST_TIMEOUT_MS = 4_000;
const DIRECTORY_URL = "/network/endpoints.v1.json";

export const FALLBACK_DIRECTORY: EndpointDirectory = {
  schemaVersion: ENDPOINT_DIRECTORY_SCHEMA_VERSION,
  revision: "built-in-cloudflare-fallback-v1",
  publishedAt: "2026-07-21T00:00:00.000Z",
  coverage: requestedCoverage(),
  endpoints: [
    {
      id: "cloudflare",
      provider: "Cloudflare",
      regionId: "global-anycast",
      regionLabel: "Global anycast (provider routed)",
      city: null,
      countryCode: null,
      status: "active",
      protocol: "HTTPS fetch via Cloudflare anycast",
      protocolVersion: null,
      downloadUrlTemplate: "https://speed.cloudflare.com/__down?bytes={bytes}",
      uploadUrl: "https://speed.cloudflare.com/__up",
      latencyUrl: "https://speed.cloudflare.com/__down?bytes=0",
      traceUrl: "https://speed.cloudflare.com/cdn-cgi/trace",
      healthUrl: null,
      echoUrl: null,
      capabilities: {
        download: true,
        upload: true,
        latency: true,
        echo: false,
        ipv4: true,
        ipv6: true,
        health: false,
        capacity: false,
        version: false,
      },
    },
  ],
};

export function requestedCoverage(): RegionalCoverage[] {
  const planned = (id: string, label: string, phase: string): RegionalCoverage => ({
    id,
    label,
    status: "planned",
    note: `${phase}; no NetPulse-operated endpoint is deployed or supported in this region yet.`,
  });
  return [
    planned("us-east", "US East", "Pilot wave 1"),
    planned("us-central", "US Central", "Expansion wave 2"),
    planned("us-west", "US West", "Expansion wave 2"),
    planned("canada", "Canada", "Expansion wave 3"),
    planned("brazil", "Brazil", "Expansion wave 3"),
    planned("united-kingdom", "United Kingdom", "Expansion wave 2"),
    planned("western-europe", "Western Europe", "Pilot wave 1"),
    planned("eastern-europe", "Eastern Europe", "Expansion wave 3"),
    planned("middle-east", "Middle East", "Expansion wave 3"),
    planned("india", "India", "Expansion wave 2"),
    planned("southeast-asia", "Southeast Asia", "Pilot wave 1"),
    planned("japan", "Japan", "Expansion wave 2"),
    planned("south-korea", "South Korea", "Expansion wave 3"),
    planned("australia", "Australia", "Pilot wave 1"),
    planned("africa", "Africa", "Expansion wave 3; location depends on measured demand and peering"),
  ];
}

export async function loadEndpointDirectory(fetcher: typeof fetch = fetch): Promise<DirectoryLoadResult> {
  const configured = import.meta.env.VITE_NETPULSE_ENDPOINT_MANIFEST_URL?.trim();
  const url = configured || DIRECTORY_URL;
  if (!isAllowedDirectoryUrl(url)) {
    return fallback("The configured endpoint directory URL must be same-origin or HTTPS.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(url, { cache: "no-store", signal: controller.signal });
    if (!response.ok) return fallback(`Endpoint directory returned HTTP ${response.status}.`);
    const parsed: unknown = await response.json();
    const directory = parseEndpointDirectory(parsed);
    if (!directory) return fallback("Endpoint directory failed schema or URL validation.");
    return { directory, source: "network-directory", warning: null };
  } catch (error) {
    const detail = error instanceof Error && error.name === "AbortError" ? "timed out" : "was unreachable";
    return fallback(`Endpoint directory ${detail}.`);
  } finally {
    clearTimeout(timer);
  }
}

export function parseEndpointDirectory(value: unknown): EndpointDirectory | null {
  if (!isRecord(value)) return null;
  if (value.schemaVersion !== ENDPOINT_DIRECTORY_SCHEMA_VERSION) return null;
  if (!isShortString(value.revision, 120) || !isIsoDate(value.publishedAt)) return null;
  if (!Array.isArray(value.coverage) || !Array.isArray(value.endpoints)) return null;

  const coverage = value.coverage.map(parseCoverage);
  const endpoints = value.endpoints.map(parseEndpoint);
  if (coverage.some((item) => item === null) || endpoints.some((item) => item === null)) return null;
  const typedCoverage = coverage as RegionalCoverage[];
  const typedEndpoints = endpoints as EndpointDirectoryEntry[];
  if (new Set(typedCoverage.map((item) => item.id)).size !== typedCoverage.length) return null;
  if (new Set(typedEndpoints.map((item) => item.id)).size !== typedEndpoints.length) return null;

  return {
    schemaVersion: ENDPOINT_DIRECTORY_SCHEMA_VERSION,
    revision: value.revision,
    publishedAt: value.publishedAt,
    coverage: typedCoverage,
    endpoints: typedEndpoints,
  };
}

export function parseEndpointHealth(value: unknown): EndpointHealth | null {
  if (!isRecord(value)) return null;
  if (!isHealthStatus(value.status)) return null;
  const protocolVersion = nullableBoundedNumber(value.protocolVersion, 1, 10_000);
  const loadPct = nullableBoundedNumber(value.loadPct, 0, 100);
  const capacityMbps = nullableBoundedNumber(value.capacityMbps, 0, 10_000_000);
  const availableCapacityMbps = nullableBoundedNumber(value.availableCapacityMbps, 0, 10_000_000);
  const activeTests = nullableBoundedNumber(value.activeTests, 0, 10_000_000);
  const maxConcurrentTests = nullableBoundedNumber(value.maxConcurrentTests, 0, 10_000_000);
  if ([protocolVersion, loadPct, capacityMbps, availableCapacityMbps, activeTests, maxConcurrentTests].includes(undefined)) return null;
  const checkedAt = nullableIsoDate(value.checkedAt);
  const expiresAt = nullableIsoDate(value.expiresAt);
  if (checkedAt === undefined || expiresAt === undefined) return null;
  if (value.serverVersion !== null && !isShortString(value.serverVersion, 80)) return null;
  if (!isShortString(value.reason, 240)) return null;
  return {
    status: value.status,
    checkedAt,
    expiresAt,
    loadPct: loadPct as number | null,
    capacityMbps: capacityMbps as number | null,
    availableCapacityMbps: availableCapacityMbps as number | null,
    activeTests: activeTests as number | null,
    maxConcurrentTests: maxConcurrentTests as number | null,
    serverVersion: value.serverVersion,
    protocolVersion: protocolVersion as number | null,
    reason: value.reason,
  };
}

export function isHealthFresh(health: EndpointHealth, now = Date.now()): boolean {
  if (!health.checkedAt || !health.expiresAt) return false;
  const checked = Date.parse(health.checkedAt);
  const expires = Date.parse(health.expiresAt);
  return Number.isFinite(checked) && Number.isFinite(expires) && checked <= now && expires >= now;
}

function parseCoverage(value: unknown): RegionalCoverage | null {
  if (!isRecord(value) || !isShortString(value.id, 80) || !isShortString(value.label, 100) || !isCoverageStatus(value.status) || !isShortString(value.note, 300)) return null;
  return { id: value.id, label: value.label, status: value.status, note: value.note };
}

function parseEndpoint(value: unknown): EndpointDirectoryEntry | null {
  if (!isRecord(value) || !isRecord(value.capabilities)) return null;
  const capabilities = parseCapabilities(value.capabilities);
  const protocolVersion = nullableBoundedNumber(value.protocolVersion, 1, 10_000);
  if (!capabilities || protocolVersion === undefined) return null;
  if (!isShortString(value.id, 80) || !isShortString(value.provider, 100) || !isShortString(value.regionId, 80) || !isShortString(value.regionLabel, 100)) return null;
  if (value.city !== null && !isShortString(value.city, 100)) return null;
  if (value.countryCode !== null && (!isShortString(value.countryCode, 2) || value.countryCode.length !== 2)) return null;
  if (!isEndpointStatus(value.status) || !isShortString(value.protocol, 120)) return null;
  if (!isAllowedMeasurementUrl(value.downloadUrlTemplate, true) || !isAllowedMeasurementUrl(value.uploadUrl) || !isAllowedMeasurementUrl(value.latencyUrl)) return null;
  if (value.traceUrl !== null && !isAllowedMeasurementUrl(value.traceUrl)) return null;
  if (value.healthUrl !== null && !isAllowedMeasurementUrl(value.healthUrl)) return null;
  if (value.echoUrl !== null && !isAllowedEchoUrl(value.echoUrl)) return null;
  if (!value.downloadUrlTemplate.includes("{bytes}")) return null;
  if (!capabilities.download || !capabilities.upload || !capabilities.latency) return null;
  if (capabilities.health !== (value.healthUrl !== null)) return null;
  if (capabilities.echo !== (value.echoUrl !== null)) return null;
  if (capabilities.capacity && !capabilities.health) return null;
  if (capabilities.version && protocolVersion === null) return null;

  return {
    id: value.id,
    provider: value.provider,
    regionId: value.regionId,
    regionLabel: value.regionLabel,
    city: value.city,
    countryCode: value.countryCode,
    status: value.status,
    protocol: value.protocol,
    protocolVersion: protocolVersion as number | null,
    downloadUrlTemplate: value.downloadUrlTemplate,
    uploadUrl: value.uploadUrl,
    latencyUrl: value.latencyUrl,
    traceUrl: value.traceUrl,
    healthUrl: value.healthUrl,
    echoUrl: value.echoUrl,
    capabilities,
  };
}

function parseCapabilities(value: Record<string, unknown>): EndpointCapabilities | null {
  const keys: (keyof EndpointCapabilities)[] = ["download", "upload", "latency", "echo", "ipv4", "ipv6", "health", "capacity", "version"];
  if (keys.some((key) => typeof value[key] !== "boolean")) return null;
  return Object.fromEntries(keys.map((key) => [key, value[key]])) as EndpointCapabilities;
}

function fallback(warning: string): DirectoryLoadResult {
  return { directory: FALLBACK_DIRECTORY, source: "built-in-fallback", warning };
}

function isAllowedDirectoryUrl(value: string): boolean {
  if (value.startsWith("/")) return !value.startsWith("//");
  return isAllowedMeasurementUrl(value);
}

function isAllowedMeasurementUrl(value: unknown, allowTemplate = false): value is string {
  if (typeof value !== "string" || value.length > 500) return false;
  const normalized = allowTemplate ? value.replace("{bytes}", "0") : value;
  try {
    const url = new URL(normalized, typeof location === "undefined" ? "https://netpulse.invalid" : location.origin);
    const localHost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    const isolatedLabHttp = import.meta.env.DEV && import.meta.env.VITE_NETPULSE_LAB_MODE === "true";
    return url.protocol === "https:" || (url.protocol === "http:" && (localHost || isolatedLabHttp));
  } catch {
    return false;
  }
}

function isAllowedEchoUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 500) return false;
  try {
    const url = new URL(value);
    const localHost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    const isolatedLabWs = import.meta.env.DEV && import.meta.env.VITE_NETPULSE_LAB_MODE === "true";
    return url.protocol === "https:" || url.protocol === "wss:" || url.protocol === "turn:" || url.protocol === "turns:" || url.protocol === "ws:" && (localHost || isolatedLabWs);
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isShortString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function nullableIsoDate(value: unknown): string | null | undefined {
  return value === null ? null : isIsoDate(value) ? value : undefined;
}

function nullableBoundedNumber(value: unknown, min: number, max: number): number | null | undefined {
  return value === null ? null : typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : undefined;
}

function isCoverageStatus(value: unknown): value is CoverageStatus {
  return value === "supported" || value === "pilot" || value === "planned" || value === "unsupported";
}

function isEndpointStatus(value: unknown): value is EndpointStatus {
  return value === "active" || value === "pilot" || value === "draining" || value === "disabled";
}

function isHealthStatus(value: unknown): value is EndpointHealthStatus {
  return value === "healthy" || value === "degraded" || value === "draining" || value === "unavailable" || value === "unknown";
}
