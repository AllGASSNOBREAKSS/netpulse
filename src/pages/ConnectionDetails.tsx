import { useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { KeyValueList, PageHeader, Section, StatusPill } from "@/components/np/Layout";
import { detectBrowser, detectDeviceClass, detectOS } from "@/lib/preflight";
import { lookupNetworkIdentity, type NetworkIdentity } from "@/lib/networkIdentity";
import type { TestResult } from "@/lib/engine";

/** A short "what does this mean" hint attached to a section heading. */
function Explain({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="size-4 shrink-0 rounded-full border border-border text-[10px] leading-none text-muted-foreground transition-colors hover:text-foreground"
          aria-label="What does this mean?"
        >
          ?
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{children}</TooltipContent>
    </Tooltip>
  );
}

export function ConnectionDetailsPage({ result }: { result: TestResult | null }) {
  const [identity, setIdentity] = useState<NetworkIdentity | null>(null);
  const [lookupState, setLookupState] = useState<"idle" | "loading" | "error">("idle");

  const runLookup = async () => {
    setLookupState("loading");
    try {
      setIdentity(await lookupNetworkIdentity());
      setLookupState("idle");
    } catch {
      setLookupState("error");
    }
  };

  const ua = navigator.userAgent;
  const conn = (navigator as unknown as { connection?: { effectiveType?: string } }).connection;
  const online = navigator.onLine;

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <PageHeader
        title="Connection Details"
        description="Live facts about this connection and device. IP-derived values describe your network's routing region, not your street address."
      />

      <Section
        title="Internet identity"
        description="Optional lookup via ipwho.is — running it discloses your public IP to that service, so it only happens when you ask. Nothing is stored or exported."
        actions={
          <StatusPill tone={identity ? "neutral" : "unknown"}>
            {identity ? "Available" : "Not requested"}
          </StatusPill>
        }
      >
        {identity ? (
          <KeyValueList
            items={[
              { k: "ISP", v: identity.isp ?? "unknown", mono: false },
              { k: "Organization", v: identity.organization ?? "unknown", mono: false },
              { k: "ASN", v: identity.asn ?? "unknown" },
              {
                k: "Approx. region",
                v:
                  [identity.city, identity.region, identity.country].filter(Boolean).join(", ") ||
                  "unknown",
                mono: false,
              },
              { k: "Masked IP", v: identity.ipMasked },
              { k: "IP version", v: identity.ipFamily },
            ]}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" onClick={() => void runLookup()} disabled={lookupState === "loading"} className="gap-1.5">
              <Search className="size-3.5" />
              {lookupState === "loading" ? "Looking up…" : "Run identity lookup"}
            </Button>
            {lookupState === "error" && (
              <span className="text-[12.5px] text-status-warn">Lookup failed or timed out — try again.</span>
            )}
          </div>
        )}
      </Section>

      <Section
        title="Current connection status"
        description="Reported by the browser itself."
        actions={
          <StatusPill tone={online ? "good" : "bad"}>{online ? "Connected" : "Offline"}</StatusPill>
        }
      >
        <KeyValueList
          items={[
            { k: "Network reachable", v: online ? "yes" : "no", mono: false },
            { k: "Reported link type", v: conn?.effectiveType ?? "not exposed" },
            { k: "Secure context", v: window.isSecureContext ? "yes (HTTPS)" : "no", mono: false },
          ]}
        />
      </Section>

      <Section
        title="Browser & device"
        description="Read locally from this browser — nothing leaves your machine."
        actions={<StatusPill tone="neutral">Available</StatusPill>}
      >
        <KeyValueList
          items={[
            { k: "Browser", v: detectBrowser(ua), mono: false },
            { k: "Operating system", v: detectOS(ua), mono: false },
            { k: "Device class", v: detectDeviceClass(), mono: false },
            { k: "Language", v: navigator.language },
            { k: "CPU threads", v: String(navigator.hardwareConcurrency ?? "unknown") },
          ]}
        />
      </Section>

      {result && (
        <Section
          title="Test server & protocol"
          description="From the most recent completed run in this session."
          actions={<StatusPill tone="good">Measured</StatusPill>}
        >
          <KeyValueList
            items={[
              {
                k: "Server",
                v: `${result.server.chosen.provider}${result.server.chosen.edgeCode ? ` · edge ${result.server.chosen.edgeCode}` : ""}`,
                mono: false,
              },
              { k: "Median latency to server", v: `${Math.round(result.server.chosen.latency.median)} ms` },
              { k: "Protocol", v: result.server.chosen.protocol, mono: false },
              { k: "IPv4 reachable", v: result.preflight.ipv4 },
              { k: "IPv6 reachable", v: result.preflight.ipv6 },
              { k: "IPv4 path median", v: result.preflight.ipComparison.ipv4.medianMs === null ? "unavailable" : `${result.preflight.ipComparison.ipv4.medianMs.toFixed(1)} ms` },
              { k: "IPv6 path median", v: result.preflight.ipComparison.ipv6.medianMs === null ? "unavailable" : `${result.preflight.ipComparison.ipv6.medianMs.toFixed(1)} ms` },
              { k: "Family comparison", v: result.preflight.ipComparison.reason, mono: false },
              { k: "Negotiated browser protocol", v: result.transportTelemetry.browserProtocol ?? "not exposed" },
              { k: "Server transport telemetry", v: result.transportTelemetry.reason, mono: false },
            ]}
          />
        </Section>
      )}

      <Section
        title={undefined}
        className="space-y-3"
      >
        <Collapsible>
          <div className="flex items-center gap-2">
            <h2 className="text-[17px] font-semibold tracking-tight">Browser limitations</h2>
            <Explain>
              A web page runs in a sandbox. Anything requiring OS or LAN access is genuinely out of
              reach, and NetPulse says so rather than estimating.
            </Explain>
            <StatusPill tone="unknown" className="ml-auto">
              Limited
            </StatusPill>
          </div>
          <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-muted-foreground">
            A web page cannot scan your LAN, list connected devices, read Wi-Fi channels, or measure
            per-device bandwidth. Any site claiming to do that from the browser alone is guessing.
          </p>
          <CollapsibleTrigger className="mt-3 text-[13px] font-medium text-primary underline-offset-4 transition-colors hover:underline">
            What that rules out
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            <KeyValueList
              items={[
                { k: "Device list on your network", v: "requires NetPulse Companion", mono: false },
                { k: "Wi-Fi signal strength / channel", v: "not exposed to web pages", mono: false },
                { k: "Per-device bandwidth", v: "requires NetPulse Companion", mono: false },
                { k: "Router model or firmware", v: "not exposed to web pages", mono: false },
                { k: "True ICMP packet loss", v: "browsers cannot send ICMP", mono: false },
                { k: "Traceroute / hop-by-hop path", v: "not available in a browser", mono: false },
              ]}
            />
          </CollapsibleContent>
        </Collapsible>
      </Section>
    </div>
  );
}
