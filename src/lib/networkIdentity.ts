import { maskIp } from "./ip";

/** Validated, deliberately small subset of an opt-in IP metadata response. */
export type NetworkIdentity = {
  isp: string | null;
  organization: string | null;
  asn: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  countryCode: string | null;
  ipFamily: "IPv4" | "IPv6" | "unknown";
  ipMasked: string;
  source: "ipwho.is";
};

const LOOKUP_URL = "https://ipwho.is/";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asnField(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return `AS${value}`;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return /^(?:AS)?\d+$/.test(normalized) ? (normalized.startsWith("AS") ? normalized : `AS${normalized}`) : null;
}

/**
 * Opt-in only: the caller must explain that this request discloses the user's
 * public IP to the lookup provider. No raw IP is returned from this function.
 */
export async function lookupNetworkIdentity(timeoutMs = 7000): Promise<NetworkIdentity> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const response = await fetch(LOOKUP_URL, {
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Lookup service returned HTTP ${response.status}.`);

    const payload: unknown = await response.json();
    if (!isRecord(payload) || payload.success !== true) {
      throw new Error("Lookup service did not return usable network metadata.");
    }
    const connection = isRecord(payload.connection) ? payload.connection : {};
    const ip = textField(payload, "ip") ?? "";
    const type = textField(payload, "type");

    return {
      isp: textField(connection, "isp"),
      organization: textField(connection, "org"),
      asn: asnField(connection.asn),
      city: textField(payload, "city"),
      region: textField(payload, "region"),
      country: textField(payload, "country"),
      countryCode: textField(payload, "country_code"),
      ipFamily: type === "IPv4" || type === "IPv6" ? type : ip.includes(":") ? "IPv6" : ip ? "IPv4" : "unknown",
      ipMasked: maskIp(ip),
      source: "ipwho.is",
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Network metadata lookup timed out.", { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
