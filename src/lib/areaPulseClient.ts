import { parseAreaPulseContext, parseAreaPulseSnapshot, type AreaPulseContext, type AreaPulseReportInput, type AreaPulseSnapshot } from "./areaPulse";

export type ReachabilityCheck = {
  label: string;
  provider: string;
  status: "reachable" | "failed" | "unavailable";
  durationMs: number | null;
  limitation: string;
};

export type SavedAreaReport = { id: string; deletionToken: string; createdAt: number; kind: string; regionLabel: string };
const SAVED_REPORTS_KEY = "netpulse_area_reports_v1";

export async function loadAreaPulseContext(signal?: AbortSignal): Promise<AreaPulseContext> {
  const response = await fetch("/api/area-pulse/context", { cache: "no-store", credentials: "omit", signal });
  if (!response.ok) throw new Error("Area Pulse context is unavailable.");
  const parsed = parseAreaPulseContext(await responseJson(response));
  if (!parsed) throw new Error("Area Pulse returned an invalid context response.");
  return parsed;
}

export async function loadAreaPulseSnapshot(signal?: AbortSignal): Promise<AreaPulseSnapshot> {
  const response = await fetch("/api/area-pulse/incidents", { cache: "no-store", credentials: "omit", signal });
  if (!response.ok) throw new Error(await responseError(response, "Regional aggregation is unavailable."));
  const parsed = parseAreaPulseSnapshot(await responseJson(response));
  if (!parsed) throw new Error("Area Pulse returned an invalid aggregate response.");
  return parsed;
}

export async function submitAreaPulseReport(input: AreaPulseReportInput): Promise<SavedAreaReport> {
  const response = await fetch("/api/area-pulse/report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), credentials: "omit" });
  const value = await responseJson(response);
  if (!response.ok) throw new Error(readError(value, "The report could not be submitted."));
  if (!isReportReceipt(value)) throw new Error("The report receipt was invalid.");
  const saved = { id: value.id, deletionToken: value.deletionToken, createdAt: Date.now(), kind: input.kind, regionLabel: value.region.label };
  saveReportReceipt(saved);
  return saved;
}

export async function deleteAreaPulseReport(report: SavedAreaReport): Promise<void> {
  const response = await fetch("/api/area-pulse/report", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: report.id, deletionToken: report.deletionToken }), credentials: "omit" });
  if (!response.ok) throw new Error(await responseError(response, "The report could not be deleted."));
  const remaining = loadSavedAreaReports().filter((item) => item.id !== report.id);
  localStorage.setItem(SAVED_REPORTS_KEY, JSON.stringify(remaining));
}

export async function submitAreaPulseAbuseReport(input: { incidentId: string; reason: "inaccurate" | "personal_data" | "spam" | "other"; details: string | null; turnstileToken: string }): Promise<void> {
  const response = await fetch("/api/area-pulse/abuse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), credentials: "omit" });
  const value = await responseJson(response);
  if (!response.ok) throw new Error(readError(value, "The abuse report could not be submitted."));
}

export async function collectAreaReachability(signal?: AbortSignal): Promise<ReachabilityCheck[]> {
  return Promise.all([
    timedFetch("NetPulse regional API", "NetPulse", "/api/area-pulse/context", "Confirms only that the NetPulse API route responds from this browser.", signal),
    timedFetch("Latency endpoint", "Cloudflare", `https://speed.cloudflare.com/__down?bytes=0&ap=${encodeURIComponent(nonce())}`, "A zero-byte HTTPS request; one destination cannot establish general internet reachability.", signal),
    timedFetch("Controlled DNS transaction", "Cloudflare DNS over HTTPS", `https://cloudflare-dns.com/dns-query?name=example.com&type=A&ct=application%2Fdns-json&ap=${encodeURIComponent(nonce())}`, "Includes HTTPS transport and does not test the operating system resolver in isolation.", signal, { Accept: "application/dns-json" }),
  ]);
}

export function loadSavedAreaReports(storage: Storage = localStorage): SavedAreaReport[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(SAVED_REPORTS_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isSavedReport).slice(0, 20) : [];
  } catch {
    return [];
  }
}

async function timedFetch(label: string, provider: string, url: string, limitation: string, externalSignal?: AbortSignal, headers?: HeadersInit): Promise<ReachabilityCheck> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  externalSignal?.addEventListener("abort", abort, { once: true });
  const timeout = window.setTimeout(() => controller.abort(), 5_000);
  const started = performance.now();
  try {
    const response = await fetch(url, { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", headers, signal: controller.signal });
    return { label, provider, status: response.ok ? "reachable" : "failed", durationMs: performance.now() - started, limitation: response.ok ? limitation : `${limitation} HTTP status ${response.status}.` };
  } catch {
    return { label, provider, status: externalSignal?.aborted ? "unavailable" : "failed", durationMs: null, limitation: externalSignal?.aborted ? "Check canceled." : limitation };
  } finally {
    window.clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abort);
  }
}

async function responseError(response: Response, fallback: string): Promise<string> {
  try {
    return readError(await responseJson(response), fallback);
  } catch {
    return fallback;
  }
}

async function responseJson(response: Response): Promise<unknown> {
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) throw new Error("Area Pulse API is unavailable in this deployment.");
  try {
    return await response.json() as unknown;
  } catch {
    throw new Error("Area Pulse returned an invalid JSON response.");
  }
}

function readError(value: unknown, fallback: string): string {
  return isRecord(value) && typeof value.error === "string" ? value.error : fallback;
}

function saveReportReceipt(report: SavedAreaReport): void {
  const current = loadSavedAreaReports();
  localStorage.setItem(SAVED_REPORTS_KEY, JSON.stringify([report, ...current.filter((item) => item.id !== report.id)].slice(0, 20)));
}

function isReportReceipt(value: unknown): value is { id: string; deletionToken: string; region: { label: string } } {
  return isRecord(value) && typeof value.id === "string" && typeof value.deletionToken === "string" && isRecord(value.region) && typeof value.region.label === "string";
}

function isSavedReport(value: unknown): value is SavedAreaReport {
  return isRecord(value) && typeof value.id === "string" && typeof value.deletionToken === "string" && typeof value.createdAt === "number" && typeof value.kind === "string" && typeof value.regionLabel === "string";
}

function nonce(): string {
  return `${Date.now().toString(36)}-${crypto.randomUUID()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
