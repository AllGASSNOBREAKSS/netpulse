import { useState } from "react";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { detectBrowser, detectDeviceClass, detectOS } from "@/lib/preflight";
import { lookupNetworkIdentity, type NetworkIdentity } from "@/lib/networkIdentity";
import type { TestResult } from "@/lib/engine";

/** Borderless key-value row — grouping by spacing, not boxes. */
function Row({ k, v, mono = true }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-1.5">
      <dt className="shrink-0 text-[13px] text-muted-foreground">{k}</dt>
      <dd className={`min-w-0 truncate text-right text-[13.5px] font-medium ${mono ? "font-mono" : ""}`} title={v}>
        {v}
      </dd>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-[15px]">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <dl className="divide-y divide-border/60">{children}</dl>
      </CardContent>
    </Card>
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

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Connection Details</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Live facts about this connection and device. IP-based values are approximate and describe
          your network's routing region, not your street address.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-1">
          <CardTitle className="text-[15px]">Internet identity</CardTitle>
          <CardDescription>
            Optional lookup via ipwho.is — running it discloses your public IP to that service, so
            it only happens when you ask. Nothing is stored or exported.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {identity ? (
            <dl className="divide-y divide-border/60">
              <Row k="ISP" v={identity.isp ?? "unknown"} mono={false} />
              <Row k="Organization" v={identity.organization ?? "unknown"} mono={false} />
              <Row k="ASN" v={identity.asn ?? "unknown"} />
              <Row k="Approx. area" v={[identity.city, identity.region, identity.country].filter(Boolean).join(", ") || "unknown"} mono={false} />
              <Row k="Masked IP" v={identity.ipMasked} />
              <Row k="IP version" v={identity.ipFamily} />
            </dl>
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
        </CardContent>
      </Card>

      <Section title="Browser & device" description="Read locally from this browser — nothing leaves your machine.">
        <Row k="Browser" v={detectBrowser(ua)} mono={false} />
        <Row k="Operating system" v={detectOS(ua)} mono={false} />
        <Row k="Device class" v={detectDeviceClass()} mono={false} />
        <Row k="Secure context" v={window.isSecureContext ? "yes (HTTPS)" : "no"} />
        <Row k="Reported link type" v={conn?.effectiveType ?? "not exposed"} />
        <Row k="Language" v={navigator.language} />
        <Row k="CPU threads" v={String(navigator.hardwareConcurrency ?? "unknown")} />
      </Section>

      {result && (
        <Section title="Last test" description="From the most recent completed run in this session.">
          <Row k="Server" v={`${result.server.chosen.provider}${result.server.chosen.edgeCode ? ` · edge ${result.server.chosen.edgeCode}` : ""}`} mono={false} />
          <Row k="Median latency to server" v={`${Math.round(result.server.chosen.latency.median)} ms`} />
          <Row k="Protocol" v={result.server.chosen.protocol} mono={false} />
          <Row k="IPv4 reachable" v={result.preflight.ipv4} />
          <Row k="IPv6 reachable" v={result.preflight.ipv6} />
        </Section>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-[15px]">Devices on your network</CardTitle>
            <Badge variant="outline" className="text-muted-foreground">Requires NetPulse Companion</Badge>
          </div>
          <Separator className="my-1" />
          <CardDescription className="leading-relaxed">
            A web page is sandboxed: it cannot scan your LAN, list connected devices, read Wi-Fi
            channels, or measure per-device bandwidth. Any website claiming to do that from the
            browser alone is guessing. Device listing, intruder alerts, and per-device usage are
            planned for the NetPulse Companion app — until then this page shows nothing rather than
            fiction.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
