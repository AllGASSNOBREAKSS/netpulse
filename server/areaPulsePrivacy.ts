import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { CoarseRegion } from "../src/lib/areaPulse";

export function coarseRegionFromRequest(request: Request): CoarseRegion | null {
  const country = cleanHeader(request.headers.get("x-vercel-ip-country"), 2)?.toUpperCase() ?? null;
  if (!country) return null;
  const subdivision = cleanHeader(request.headers.get("x-vercel-ip-country-region"), 40);
  const city = decodeHeader(request.headers.get("x-vercel-ip-city"), 80);
  if (city && subdivision) return region(`${country}|${subdivision}|${city}`, `${city}, ${subdivision}`, "city", country);
  if (subdivision) return region(`${country}|${subdivision}`, `${subdivision}, ${country}`, "subdivision", country);
  return region(country, country, "country", country);
}

export function transientRequestIp(request: Request): string | null {
  // This Vercel-specific header is a security input for rate limiting. Do not
  // fall back to forwarding headers that an upstream proxy could overwrite.
  const candidate = request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ?? null;
  if (!candidate || candidate.length > 64 || !/^[0-9a-fA-F:.]+$/.test(candidate)) return null;
  return candidate;
}

export function privacyKey(secret: string, purpose: string, value: string): string {
  return createHmac("sha256", secret).update(`area-pulse:v1:${purpose}:${value}`).digest("hex");
}

export function deletionTokenHash(token: string): string {
  return createHash("sha256").update(`area-pulse-delete:v1:${token}`).digest("hex");
}

export function safeSecretEqual(expected: string, supplied: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

function region(key: string, label: string, level: CoarseRegion["level"], countryCode: string): CoarseRegion {
  return { key: key.toLowerCase(), label, level, countryCode, approximate: true };
}

function decodeHeader(value: string | null, max: number): string | null {
  if (!value) return null;
  try {
    return cleanHeader(decodeURIComponent(value), max);
  } catch {
    return null;
  }
}

function cleanHeader(value: string | null, max: number): string | null {
  if (!value) return null;
  const cleaned = value.trim().replace(/[^\p{L}\p{N} .,'-]/gu, "").slice(0, max);
  return cleaned || null;
}
