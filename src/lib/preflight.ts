/**
 * Preflight inspection: browser-accessible, privacy-safe facts only.
 *
 * Explicitly NOT collected (and impossible from a sandboxed page): Wi-Fi SSID,
 * password, router channel, signal strength, nearby networks, router model, or
 * the list of devices on the LAN. Anything uncertain is labeled "unknown" or
 * "possible" — never asserted.
 */
import { getServer } from "./servers";
import { profileDataCeilingMB, resolveProfile, type ProfileId } from "./profiles";
import { linkAbortSignal, throwIfCancelled } from "./cancellation";
import { summarize } from "./stats";
import type { IpFamilyComparison, IpFamilySample, Preflight, TestConfig, TriState } from "./types";

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

/** Best-effort family-specific HTTPS timing. Opaque responses still prove a completed connection. */
async function measureFamily(url: string, samples = 3, timeoutMs = 3500, signal?: AbortSignal): Promise<IpFamilySample> {
  const rtts: number[] = [];
  let failed = 0;
  for (let index = 0; index < samples; index += 1) {
    const ctrl = new AbortController();
    const unlink = linkAbortSignal(ctrl, signal);
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const startedAt = performance.now();
    try {
      await fetch(`${url}${url.includes("?") ? "&" : "?"}np=${index}-${Math.round(startedAt)}`, {
        mode: "no-cors",
        cache: "no-store",
        signal: ctrl.signal,
      });
      rtts.push(performance.now() - startedAt);
    } catch {
      throwIfCancelled(signal);
      failed += 1;
    } finally {
      clearTimeout(timer);
      unlink();
    }
  }
  const summary = summarize(rtts);
  return {
    status: rtts.length > 0 ? "yes" : "unknown",
    medianMs: rtts.length ? summary.median : null,
    p95Ms: rtts.length ? summary.p95 : null,
    jitterMs: rtts.length > 1 ? summary.jitter : null,
    successful: rtts.length,
    failed,
    method: "Family-specific HTTPS fetch timing; includes browser, TLS/HTTP, endpoint, and route effects.",
  };
}

export function compareIpFamilies(ipv4: IpFamilySample, ipv6: IpFamilySample): IpFamilyComparison {
  if (ipv4.medianMs === null || ipv6.medianMs === null) {
    return {
      ipv4,
      ipv6,
      preferred: "unavailable",
      differenceMs: null,
      reason: "Both IPv4 and IPv6 need successful family-specific HTTPS samples before their paths can be compared.",
    };
  }
  const differenceMs = Math.abs(ipv4.medianMs - ipv6.medianMs);
  const similarThresholdMs = Math.max(3, Math.min(ipv4.medianMs, ipv6.medianMs) * 0.1);
  const preferred = differenceMs <= similarThresholdMs ? "similar" : ipv4.medianMs < ipv6.medianMs ? "IPv4" : "IPv6";
  return {
    ipv4,
    ipv6,
    preferred,
    differenceMs,
    reason: preferred === "similar"
      ? `Family-specific HTTPS medians were within ${similarThresholdMs.toFixed(1)} ms.`
      : `${preferred} had the lower family-specific HTTPS median by ${differenceMs.toFixed(1)} ms. This does not prove every destination uses the same route.`,
  };
}

type TraceInfo = Record<string, string>;
async function fetchTrace(timeoutMs = 5000, signal?: AbortSignal): Promise<TraceInfo | null> {
  const tracePath = getServer(undefined).tracePath;
  if (!tracePath) return null;
  const ctrl = new AbortController();
  const unlink = linkAbortSignal(ctrl, signal);
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const response = await fetch(tracePath, {
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
    throwIfCancelled(signal);
    return null;
  } finally {
    clearTimeout(timer);
    unlink();
  }
}

function guessVpnProxy(trace: TraceInfo | null): { state: Preflight["vpnProxy"]; reason: string } {
  if (!trace) return { state: "unknown", reason: "Connection metadata unavailable." };
  if (trace.warp === "on")
    return { state: "possible", reason: "Cloudflare WARP is active on this connection." };
  return {
    state: "unknown",
    reason:
      "No reliable browser-only signal can distinguish a VPN or proxy from travel, provider routing, or normal address registration. Cloudflare WARP was not reported as active, but other VPNs remain unknown.",
  };
}

export async function runPreflight(cfg: TestConfig): Promise<Preflight> {
  throwIfCancelled(cfg.signal);
  const ua = navigator.userAgent;
  const conn = (navigator as unknown as { connection?: { effectiveType?: string } }).connection;

  const [trace, v4Sample, v6Sample] = await Promise.all([
    fetchTrace(5000, cfg.signal),
    measureFamily("https://ipv4.cloudflare.com/cdn-cgi/trace", 3, 3500, cfg.signal),
    measureFamily("https://ipv6.cloudflare.com/cdn-cgi/trace", 3, 3500, cfg.signal),
  ]);

  // The family currently in use is definitive from the trace IP; the other is
  // the best-effort probe above.
  const activeFamily: TriState = trace?.ip?.includes(":") ? "yes" : "no";
  const ipv4: TriState = trace?.ip && !trace.ip.includes(":") ? "yes" : v4Sample.status;
  const ipv6: TriState = activeFamily === "yes" ? "yes" : v6Sample.status;
  const ipComparison = compareIpFamilies(v4Sample, v6Sample);

  const vpn = guessVpnProxy(trace);
  const est = estimate(cfg.lowData, cfg.profile);

  return {
    browser: detectBrowser(ua),
    os: detectOS(ua),
    deviceClass: detectDeviceClass(),
    tabForeground: typeof document !== "undefined" ? document.visibilityState === "visible" : true,
    secureContext: typeof window !== "undefined" ? window.isSecureContext : true,
    ipv4,
    ipv6,
    ipComparison,
    connectionType: conn?.effectiveType ?? null,
    vpnProxy: vpn.state,
    vpnProxyReason: vpn.reason,
    estimatedDurationSec: est.durationSec,
    estimatedDataMB: est.dataMB,
    estimatedDataMaxMB: est.dataMaxMB,
  };
}

/** Rough estimates shown before the test so users can opt out on metered links. */
export function estimate(lowData: boolean, profileId?: ProfileId): { durationSec: number; dataMB: number; dataMaxMB: number } {
  const profile = resolveProfile(profileId, lowData);
  return {
    durationSec: profile.estimatedDurationSec,
    dataMB: profile.estimatedDataMB,
    dataMaxMB: profileDataCeilingMB(lowData, profileId),
  };
}
