/** Internal comparison contracts. These adapters never replace public results. */
export type ValidationAdapterKind = "netpulse-native" | "netpulse-echo" | "netpulse-regional" | "iperf3-lab" | "ookla-cli" | "mlab";

export type ValidationAdapterDescriptor = {
  kind: ValidationAdapterKind;
  label: string;
  enabledByDefault: false;
  availability: "implemented" | "lab-only" | "infrastructure-required" | "not-installed";
  publicResultEligible: false;
  purpose: string;
  termsNote: string;
};

export const VALIDATION_ADAPTERS: readonly ValidationAdapterDescriptor[] = [
  { kind: "netpulse-native", label: "NetPulse native browser engine", enabledByDefault: false, availability: "implemented", publicResultEligible: false, purpose: "Re-run the native engine under controlled validation orchestration.", termsNote: "NetPulse-owned method; this registry is internal only." },
  { kind: "netpulse-echo", label: "NetPulse WebSocket/WebRTC echo", enabledByDefault: false, availability: "infrastructure-required", publicResultEligible: false, purpose: "Validate packet loss and ordering once reviewed echo infrastructure exists.", termsNote: "Unavailable until a privacy and abuse reviewed service is deployed." },
  { kind: "netpulse-regional", label: "NetPulse regional endpoint", enabledByDefault: false, availability: "infrastructure-required", publicResultEligible: false, purpose: "Compare validated NetPulse regions without changing the public result.", termsNote: "No regional adapter is enabled without independently validated endpoints." },
  { kind: "iperf3-lab", label: "iperf3 controlled baseline", enabledByDefault: false, availability: "lab-only", publicResultEligible: false, purpose: "Provide an independent controlled throughput baseline.", termsNote: "Runs only in the isolated engineering laboratory." },
  { kind: "ookla-cli", label: "Optional Ookla CLI comparison", enabledByDefault: false, availability: "not-installed", publicResultEligible: false, purpose: "Investigate methodological disagreement when an operator separately installs and accepts applicable terms.", termsNote: "Never bundled, invoked, or accepted on a user's behalf." },
  { kind: "mlab", label: "Optional M-Lab comparison", enabledByDefault: false, availability: "not-installed", publicResultEligible: false, purpose: "Investigate endpoint and methodology differences using documented M-Lab tooling.", termsNote: "Not installed or silently queried by NetPulse." },
] as const;
