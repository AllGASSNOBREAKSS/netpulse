import { isIP } from "node:net";
import { isAreaReportKind, type AreaPulseReportInput, type IncidentStatus } from "../src/lib/areaPulse";

export type ValidProviderMessage = {
  id: string;
  isp: string;
  asn: string | null;
  regionKey: string | null;
  regionLabel: string | null;
  regionLevel: "city" | "subdivision" | "country" | null;
  countryCode: string | null;
  title: string;
  message: string;
  status: IncidentStatus;
  publishedAt: Date;
  expiresAt: Date;
  sourceUrl: string;
  sourceLabel: string;
};

export type ValidAbuseReport = {
  incidentId: string;
  reason: "inaccurate" | "personal_data" | "spam" | "other";
  details: string | null;
  turnstileToken: string;
};

export function validateAreaReport(value: unknown): { ok: true; value: AreaPulseReportInput } | { ok: false; error: string } {
  if (!isRecord(value) || !isAreaReportKind(value.kind)) return invalid("Choose a supported incident type.");
  const isp = cleanText(value.isp, 2, 80);
  if (!isp) return invalid("ISP is required and must be 2–80 characters.");
  const asn = normalizeAsn(value.asn);
  if (value.asn !== null && value.asn !== "" && asn === null) return invalid("ASN must use a value such as AS64500.");
  const service = nullableText(value.service, 2, 80);
  if (value.kind === "service_unavailable" && !service) return invalid("Name the unavailable service using 2–80 characters.");
  const note = nullableText(value.note, 2, 240);
  if (value.note !== null && value.note !== "" && !note) return invalid("The optional note contains unsupported characters or length.");
  if (note && (containsContactOrUrl(note) || /[<>]/.test(note) || /(.)\1{11,}/u.test(note))) return invalid("Notes cannot contain markup, links, contact details, or repeated-character spam.");
  if (typeof value.turnstileToken !== "string" || value.turnstileToken.length < 1 || value.turnstileToken.length > 2048) return invalid("Complete the anti-abuse verification.");
  if (value.identityConsent !== true) return invalid("Consent to coarse regional and provider grouping is required for a public report.");
  const measurement = validateMeasurement(value.measurement);
  if (value.measurement !== null && measurement === null) return invalid("The attached measurement summary is invalid.");
  return { ok: true, value: { kind: value.kind, isp, asn, service, note, turnstileToken: value.turnstileToken, identityConsent: true, measurement } };
}

export function validateProviderMessage(value: unknown, now = Date.now()): { ok: true; value: ValidProviderMessage } | { ok: false; error: string } {
  if (!isRecord(value)) return invalid("Invalid provider message body.");
  const id = identifier(value.id, 80);
  const isp = cleanText(value.isp, 2, 80);
  const title = cleanText(value.title, 2, 140);
  const message = cleanText(value.message, 2, 600);
  const sourceLabel = cleanText(value.sourceLabel, 2, 100);
  const sourceUrl = httpsUrl(value.sourceUrl);
  const asn = normalizeAsn(value.asn);
  const status = value.status === "active" || value.status === "monitoring" || value.status === "resolved" ? value.status : null;
  const publishedAt = date(value.publishedAt);
  const expiresAt = date(value.expiresAt);
  const regionLevel = value.regionLevel === null || value.regionLevel === "city" || value.regionLevel === "subdivision" || value.regionLevel === "country" ? value.regionLevel : undefined;
  const regionKey = nullableText(value.regionKey, 2, 180)?.toLowerCase() ?? null;
  const regionLabel = nullableText(value.regionLabel, 2, 120);
  const countryCode = typeof value.countryCode === "string" && /^[A-Za-z]{2}$/.test(value.countryCode) ? value.countryCode.toUpperCase() : null;
  if (!id || !isp || !title || !message || !sourceLabel || !sourceUrl || !status || !publishedAt || !expiresAt || regionLevel === undefined) return invalid("Provider message fields are missing or invalid.");
  if (expiresAt.getTime() <= now || expiresAt.getTime() > now + 30 * 86_400_000) return invalid("Provider-message expiry must be within the next 30 days.");
  if (publishedAt.getTime() > now + 5 * 60_000) return invalid("Provider-message timestamp cannot be in the future.");
  if ((regionKey || regionLabel || regionLevel || countryCode) && !(regionKey && regionLabel && regionLevel && countryCode)) return invalid("Regional provider messages require a complete coarse region.");
  return { ok: true, value: { id, isp, asn, regionKey, regionLabel, regionLevel, countryCode, title, message, status, publishedAt, expiresAt, sourceUrl, sourceLabel } };
}

export function validateAbuseReport(value: unknown): { ok: true; value: ValidAbuseReport } | { ok: false; error: string } {
  if (!isRecord(value)) return invalid("Invalid abuse report body.");
  const incidentId = identifier(value.incidentId, 240);
  const reason = value.reason === "inaccurate" || value.reason === "personal_data" || value.reason === "spam" || value.reason === "other" ? value.reason : null;
  const details = nullableText(value.details, 2, 500);
  if (!incidentId || !reason) return invalid("Choose a valid incident and reason.");
  if (value.details !== null && value.details !== "" && !details) return invalid("Details must be 2-500 supported characters.");
  if (details && (containsContactOrUrl(details) || /[<>]/.test(details))) return invalid("Details cannot contain markup, links, or contact information.");
  if (typeof value.turnstileToken !== "string" || value.turnstileToken.length < 1 || value.turnstileToken.length > 2048) return invalid("Complete the anti-abuse verification.");
  return { ok: true, value: { incidentId, reason, details, turnstileToken: value.turnstileToken } };
}

export function providerKey(isp: string, asn: string | null): string {
  return asn?.toLowerCase() ?? isp.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

function validateMeasurement(value: unknown): AreaPulseReportInput["measurement"] | null {
  if (value === null) return null;
  if (!isRecord(value)) return null;
  const confidence = nullableNumber(value.confidence, 0, 100);
  const downloadMbps = nullableNumber(value.downloadMbps, 0, 100_000);
  const uploadMbps = nullableNumber(value.uploadMbps, 0, 100_000);
  const idleLatencyMs = nullableNumber(value.idleLatencyMs, 0, 60_000);
  const dnsFailed = nullableBoolean(value.dnsFailed);
  const primaryReachable = nullableBoolean(value.primaryReachable);
  if (confidence === undefined || downloadMbps === undefined || uploadMbps === undefined || idleLatencyMs === undefined || dnsFailed === undefined || primaryReachable === undefined) return null;
  return { confidence, downloadMbps, uploadMbps, idleLatencyMs, dnsFailed, primaryReachable };
}

function normalizeAsn(value: unknown): string | null {
  if (value === null || value === "" || value === undefined) return null;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase().replace(/^AS\s*/, "AS");
  return /^AS[1-9]\d{0,9}$/.test(normalized) ? normalized : null;
}

function cleanText(value: unknown, min: number, max: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = [...value].filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127).join("").trim().replace(/\s+/g, " ");
  return cleaned.length >= min && cleaned.length <= max ? cleaned : null;
}

function nullableText(value: unknown, min: number, max: number): string | null {
  return value === null || value === "" || value === undefined ? null : cleanText(value, min, max);
}

function identifier(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length <= max && /^[A-Za-z0-9_-]+$/.test(value) ? value : null;
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 500) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || !isPublicHostname(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function isPublicHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized.endsWith(".local") || normalized.endsWith(".internal")) return false;
  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    const [a, b] = normalized.split(".").map(Number);
    return !(a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168));
  }
  if (ipVersion === 6) return normalized !== "::1" && !normalized.startsWith("fc") && !normalized.startsWith("fd") && !normalized.startsWith("fe80");
  return /^[a-z0-9.-]+$/.test(normalized) && normalized.includes(".");
}

function date(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function nullableNumber(value: unknown, min: number, max: number): number | null | undefined {
  if (value === null) return null;
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : undefined;
}

function nullableBoolean(value: unknown): boolean | null | undefined {
  return value === null || typeof value === "boolean" ? value : undefined;
}

function containsContactOrUrl(value: string): boolean {
  return /https?:\/\/|www\.|\b\S+@\S+\.\S+\b/i.test(value);
}

function invalid(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
