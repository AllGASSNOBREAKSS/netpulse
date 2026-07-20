/**
 * Preflight inspection: browser-accessible, privacy-safe facts only.
 *
 * Explicitly NOT collected (and impossible from a sandboxed page): Wi-Fi SSID,
 * password, router channel, signal strength, nearby networks, router model, or
 * the list of devices on the LAN. Anything uncertain is labeled "unknown" or
 * "possible" — never asserted.
 */
import { getServer } from "./servers";
import type { Preflight, TestConfig, TriState } from "./types";

export function detectBrowser(ua: string): string {
  // Order matters: Edge/Brave/Opera masquerade as Chrome.
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Chrome\//.test(ua)) return "Chrome / Chromium";
  if (/Safari\//.test(ua)) return "Safari";
  return "Unknown browser";
}

export function detectOS(ua: string): string {
  if (/Windows NT 10/.test(ua)) return "Windows 10/11";
  if (/Windows/.test(ua)) return "Windows";
  if (/Android/.test(ua)) return "Android";
  if (/(iPhone|iPad|iPod)/.test(ua)) return "iOS/iPadOS";
  if (/Mac OS X/.test(ua)) return "macOS";
  if (/Linux/.test(ua)) return "Linux";
  return "Unknown OS";
}

export function detectDeviceClass(): Preflight["deviceClass"] {
  const uaData = (navigator as unknown as { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (uaData?.mobile) return "mobile";
  const ua = navigator.userAgent;
  if (/iPad|Tablet/.test(ua)) return "tablet";
  if (/Mobi|Android/.test(ua)) return "mobile";
  if (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches && window.innerWidth < 900)
    return "tablet";
  return "desktop";
}

/** Best-effort reachability of one IP family via an opaque no-cors fetch. */
async function familyReachable(url: string, timeoutMs = 3500): Promise<TriState> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    await fetch(url, { mode: "no-cors", cache: "no-store", signal: ctrl.signal });
    return "yes"; // opaque response still resolves on successful connect
  } catch {
    // A browser cannot distinguish an unavailable IP family from a blocked
    // cross-origin request, privacy extension, or local policy. "unknown" is
    // more accurate than asserting that the network has no connectivity.
    return "unknown";
  } finally {
    clearTimeout(timer);
  }
}

type TraceInfo = Record<string, string>;
async function fetchTrace(timeoutMs = 5000): Promise<TraceInfo | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const response = await fetch(getServer(undefined).tracePath, {
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (!response.ok) return null;
    const t = await response.text();
    const info: TraceInfo = {};
    for (const line of t.trim().split("\n")) {
      const [k, v] = line.split("=");
      if (k && v) info[k] = v;
    }
    return info;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function guessVpnProxy(trace: TraceInfo | null): { state: Preflight["vpnProxy"]; reason: string } {
  if (!trace) return { state: "unknown", reason: "Connection metadata unavailable." };
  if (trace.warp === "on")
    return { state: "possible", reason: "Cloudflare WARP is active on this connection." };
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    const tzRegion = tz.split("/")[0]; // e.g. "America", "Europe"
    const country = trace.loc || "";
    const tzToContinent: Record<string, string[]> = {
      America: ["US", "CA", "MX", "BR", "AR", "CL", "CO"],
      Europe: ["GB", "FR", "DE", "NL", "ES", "IT", "SE", "PL", "IE"],
      Asia: ["JP", "SG", "IN", "HK", "KR", "CN"],
      Australia: ["AU", "NZ"],
    };
    const expected = tzToContinent[tzRegion];
    if (expected && country && !expected.includes(country))
      return {
        state: "possible",
        reason: `Your timezone (${tz}) doesn't match the IP's country (${country}) — a VPN, proxy, or travel could explain it.`,
      };
    return { state: "unlikely", reason: "Timezone and IP location are broadly consistent (heuristic only)." };
  } catch {
    return { state: "unknown", reason: "Could not compare timezone to IP location." };
  }
}

export async function runPreflight(cfg: TestConfig): Promise<Preflight> {
  const ua = navigator.userAgent;
  const conn = (navigator as unknown as { connection?: { effectiveType?: string } }).connection;

  const [trace, v4, v6] = await Promise.all([
    fetchTrace(),
    familyReachable("https://1.1.1.1/cdn-cgi/trace"),
    familyReachable("https://[2606:4700:4700::1111]/cdn-cgi/trace"),
  ]);

  // The family currently in use is definitive from the trace IP; the other is
  // the best-effort probe above.
  const activeFamily: TriState = trace?.ip?.includes(":") ? "yes" : "no";
  const ipv4: TriState = trace?.ip && !trace.ip.includes(":") ? "yes" : v4;
  const ipv6: TriState = activeFamily === "yes" ? "yes" : v6;

  const vpn = guessVpnProxy(trace);
  const est = estimate(cfg.lowData);

  return {
    browser: detectBrowser(ua),
    os: detectOS(ua),
    deviceClass: detectDeviceClass(),
    tabForeground: typeof document !== "undefined" ? document.visibilityState === "visible" : true,
    secureContext: typeof window !== "undefined" ? window.isSecureContext : true,
    ipv4,
    ipv6,
    connectionType: conn?.effectiveType ?? null,
    vpnProxy: vpn.state,
    vpnProxyReason: vpn.reason,
    estimatedDurationSec: est.durationSec,
    estimatedDataMB: est.dataMB,
  };
}

/** Rough estimates shown before the test so users can opt out on metered links. */
export function estimate(lowData: boolean): { durationSec: number; dataMB: number } {
  return lowData ? { durationSec: 20, dataMB: 40 } : { durationSec: 34, dataMB: 250 };
}
