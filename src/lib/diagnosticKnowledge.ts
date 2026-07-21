import type { DiagnosticConditions, DiagnosticRunKind, DiagnosticSymptom } from "./diagnostics";

export type DiagnosticComparison = {
  kind: Exclude<DiagnosticRunKind, "baseline">;
  title: string;
  shortLabel: string;
  why: string;
  instructions: string[];
  changes: Partial<DiagnosticConditions>;
  available: boolean;
  limitation?: string;
};

export const COMPARISONS: readonly DiagnosticComparison[] = [
  {
    kind: "near-router",
    title: "Test beside the router",
    shortLabel: "Near router",
    why: "A matched improvement near the access point supports a local wireless-path issue, but cannot distinguish coverage from interference.",
    instructions: ["Use the same device.", "Stay on Wi-Fi and move beside the router or access point.", "Keep VPN and background-traffic state unchanged.", "Run the test once; do not start other transfers."],
    changes: { link: "wifi", location: "near-router" },
    available: true,
  },
  {
    kind: "original-room",
    title: "Retest in the original room",
    shortLabel: "Original room",
    why: "Repeating the original condition checks whether a near-router improvement persists when you return to the problem location.",
    instructions: ["Return to the room where the symptom occurs.", "Use the same device and Wi-Fi network.", "Keep VPN and traffic state matched.", "Run the test once."],
    changes: { link: "wifi", location: "usual" },
    available: true,
  },
  {
    kind: "ethernet",
    title: "Connect by Ethernet",
    shortLabel: "Ethernet",
    why: "A wired comparison bypasses the Wi-Fi radio path and is the strongest browser-safe way to test whether the local wireless link is involved.",
    instructions: ["Connect the same device directly to the router with Ethernet.", "Disable Wi-Fi so the browser actually uses Ethernet.", "Keep VPN and other traffic unchanged.", "Confirm the link, then run the test."],
    changes: { link: "ethernet", location: "near-router" },
    available: true,
  },
  {
    kind: "vpn-off",
    title: "Disable the VPN temporarily",
    shortLabel: "VPN off",
    why: "A back-to-back VPN-on/off pair can show overhead or routing impact. NetPulse cannot reliably detect most VPNs automatically.",
    instructions: ["Only proceed if policy permits disabling the VPN.", "Confirm the baseline was run with VPN on.", "Disable it without changing location or link.", "Run the comparison, then restore required protection."],
    changes: { vpn: "off" },
    available: true,
  },
  {
    kind: "background-paused",
    title: "Pause background traffic",
    shortLabel: "Traffic paused",
    why: "Cloud sync, updates, backups, streams, and other household transfers can consume capacity or fill queues.",
    instructions: ["Pause large transfers on this device.", "Ask other users to pause streams or downloads briefly.", "Keep link, location, and VPN unchanged.", "Run the test, then resume normal activity."],
    changes: { backgroundTraffic: "paused" },
    available: true,
  },
  {
    kind: "other-device",
    title: "Compare another device",
    shortLabel: "Other device",
    why: "A co-located second-device comparison can separate a shared network problem from a device/browser-specific limit.",
    instructions: ["Place the second device beside the first.", "Use the same link type, VPN state, and power source if practical.", "Close heavy applications.", "Run one device at a time and return to this locally saved session."],
    changes: { device: "other" },
    available: true,
  },
  {
    kind: "router-restarted",
    title: "Retest after a router restart",
    shortLabel: "Router restarted",
    why: "A restart can reveal temporary gateway state, but changes several conditions and never proves hardware failure.",
    instructions: ["Save work for everyone using the network.", "Use the router's normal restart control or power guidance.", "Wait until service is fully restored.", "Return with the same device and conditions, then run once."],
    changes: { afterRestart: "router" },
    available: true,
  },
  {
    kind: "modem-restarted",
    title: "Retest after a modem or gateway restart",
    shortLabel: "Modem restarted",
    why: "A post-restart change is useful operational evidence but does not identify provisioning, signal, firmware, or hardware as the cause.",
    instructions: ["Follow the provider or device manufacturer's official restart instructions.", "Do not factory-reset the device.", "Wait for normal service indicators.", "Repeat with the original test conditions."],
    changes: { afterRestart: "modem" },
    available: true,
  },
  {
    kind: "peak-time",
    title: "Record a peak-time run",
    shortLabel: "Peak time",
    why: "Repeated evening-versus-off-peak pairs can expose a time-correlated constraint, especially over Ethernet.",
    instructions: ["Choose the time when the symptom usually occurs.", "Prefer Ethernet and pause household transfers.", "Record the conditions exactly.", "Repeat on another day before assigning a provider cause."],
    changes: { time: "peak" },
    available: true,
  },
  {
    kind: "off-peak",
    title: "Record an off-peak run",
    shortLabel: "Off peak",
    why: "An otherwise matched off-peak result is the comparison half needed to evaluate a time-of-day pattern.",
    instructions: ["Use the same device, link, location, and VPN state as the peak run.", "Pause household transfers.", "Use the same NetPulse profile.", "Run once and compare."],
    changes: { time: "off-peak" },
    available: true,
  },
  {
    kind: "ipv4",
    title: "Compare IPv4",
    shortLabel: "IPv4",
    why: "Path families can route differently, but a browser cannot force the operating system to use one family for this endpoint.",
    instructions: ["Use an operating-system or controlled endpoint tool that explicitly binds IPv4.", "Record the endpoint and timing.", "Compare with an otherwise identical IPv6 run."],
    changes: { requestedIpFamily: "ipv4" },
    available: false,
    limitation: "Measurement unavailable in this browser: NetPulse can report the observed trace family but cannot force IPv4.",
  },
  {
    kind: "ipv6",
    title: "Compare IPv6",
    shortLabel: "IPv6",
    why: "Path families can route differently, but a browser cannot force the operating system to use one family for this endpoint.",
    instructions: ["Use an operating-system or controlled endpoint tool that explicitly binds IPv6.", "Record the endpoint and timing.", "Compare with an otherwise identical IPv4 run."],
    changes: { requestedIpFamily: "ipv6" },
    available: false,
    limitation: "Measurement unavailable in this browser: NetPulse can report the observed trace family but cannot force IPv6.",
  },
] as const;

export type Guide = {
  id: string;
  title: string;
  summary: string;
  body: string[];
  sourceLabel: string;
  sourceUrl: string;
};

export const GUIDES: readonly Guide[] = [
  {
    id: "latency-jitter",
    title: "Latency and jitter",
    summary: "Latency is delay; jitter is variation between latency samples.",
    body: ["Interactive apps often care more about consistent delay than headline throughput.", "NetPulse calculates jitter from consecutive real idle-latency samples; it does not infer packet loss from jitter."],
    sourceLabel: "IETF RFC 3393",
    sourceUrl: "https://www.rfc-editor.org/rfc/rfc3393",
  },
  {
    id: "bufferbloat",
    title: "Bufferbloat and queue management",
    summary: "Oversized or unmanaged queues can add delay while a connection is busy.",
    body: ["NetPulse subtracts idle median latency from download-loaded and upload-loaded medians.", "The result proves measured queueing under load, not which router, modem, or provider queue owns it."],
    sourceLabel: "IETF RFC 7567",
    sourceUrl: "https://www.rfc-editor.org/rfc/rfc7567",
  },
  {
    id: "dns",
    title: "DNS is not download speed",
    summary: "DNS translates names before a connection is established; it does not set sustained transfer capacity.",
    body: ["A slow or unreliable resolver can delay the start of a website request.", "This browser test cannot isolate recursive resolution from caching, connection setup, and HTTPS transfer, so NetPulse does not display a DNS latency value."],
    sourceLabel: "ICANN DNS overview",
    sourceUrl: "https://www.icann.org/resources/pages/dns-2022-09-13-en",
  },
  {
    id: "wifi-ethernet",
    title: "Why compare Wi-Fi and Ethernet",
    summary: "Ethernet removes the local wireless radio path from the comparison.",
    body: ["A materially better wired result supports a local Wi-Fi-path issue.", "Browser APIs do not expose trustworthy signal strength, channel utilization, nearby networks, or router radio state, so NetPulse cannot separate coverage from interference."],
    sourceLabel: "Microsoft Support: Wi-Fi and your home layout",
    sourceUrl: "https://support.microsoft.com/en-us/windows/experience/connectivity-networking/wi-fi-and-your-home-layout",
  },
  {
    id: "privacy",
    title: "Privacy-safe evidence",
    summary: "Useful troubleshooting records do not need a full public IP or network name.",
    body: ["Diagnostic sessions stay in this browser and store summary metrics, endpoint metadata, and conditions you select.", "Reports exclude full public IP addresses, SSIDs, device names, browsing history, and credentials."],
    sourceLabel: "NetPulse privacy policy",
    sourceUrl: "https://github.com/bbarc0de/netpulse/blob/main/POLICIES.md#privacy",
  },
] as const;

export function recommendedComparisons(symptom: DiagnosticSymptom): DiagnosticRunKind[] {
  if (symptom === "offline") return ["other-device", "router-restarted"];
  if (symptom === "slow-websites") return ["ethernet", "other-device", "vpn-off"];
  if (symptom === "gaming" || symptom === "video-calls" || symptom === "intermittent") {
    return ["ethernet", "near-router", "background-paused", "vpn-off"];
  }
  return ["near-router", "ethernet", "background-paused", "other-device"];
}
