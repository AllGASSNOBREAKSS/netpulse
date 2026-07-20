import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { detectBrowser, detectDeviceClass, detectOS } from "@/lib/preflight";
import { coloDistanceKm, fetchMeta, type NetworkMeta } from "@/lib/servers";
import { maskIp } from "@/lib/ip";
import type { TestResult } from "@/lib/engine";

function KV({ k, v, mono = true }: { k: string; v: string; mono?: boolean }) {
  return (
    <Card className="py-3">
      <CardContent className="px-4">
        <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">{k}</div>
        <div className={`mt-0.5 truncate text-sm font-semibold ${mono ? "font-mono" : ""}`} title={v}>
          {v}
        </div>
      </CardContent>
    </Card>
  );
}

export function ConnectionDetailsPage({ result }: { result: TestResult | null }) {
  const [meta, setMeta] = useState<NetworkMeta | null>(null);
  const [metaFailed, setMetaFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchMeta(undefined).then((m) => {
      if (cancelled) return;
      if (m) setMeta(m);
      else setMetaFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const ua = navigator.userAgent;
  const conn = (navigator as unknown as { connection?: { effectiveType?: string } }).connection;
  const dist = coloDistanceKm(meta);
  const pend = metaFailed ? "unavailable" : "…";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-extrabold italic">Connection Details</h1>
        <p className="text-sm text-muted-foreground">
          Live facts about this connection and device. IP-based values are approximate and describe
          your network's routing region, not your street address.
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Internet identity</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KV k="ISP" v={meta?.org ?? pend} mono={false} />
          <KV k="ASN" v={meta?.asn != null ? `AS${meta.asn}` : pend} />
          <KV k="Masked IP" v={meta?.clientIp ? maskIp(meta.clientIp) : pend} />
          <KV k="IP version" v={meta?.ipFamily ?? pend} />
          <KV k="Approx. region" v={meta?.city ? `${meta.city}, ${meta.region ?? meta.country ?? ""}` : pend} mono={false} />
          <KV k="Nearest edge" v={meta?.coloCity ? `${meta.coloCity} (${meta.colo})` : pend} mono={false} />
          <KV k="Edge distance" v={dist != null ? `~${dist} km` : pend} />
          <KV k="Test protocol" v="HTTPS (fetch, anycast)" />
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Browser &amp; device</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KV k="Browser" v={detectBrowser(ua)} mono={false} />
          <KV k="Operating system" v={detectOS(ua)} mono={false} />
          <KV k="Device class" v={detectDeviceClass()} mono={false} />
          <KV k="Secure context" v={window.isSecureContext ? "yes (HTTPS)" : "no"} />
          <KV k="Reported link type" v={conn?.effectiveType ?? "not exposed"} />
          <KV k="Languages" v={navigator.language} />
          <KV k="CPU threads" v={String(navigator.hardwareConcurrency ?? "unknown")} />
          <KV k="Online" v={navigator.onLine ? "yes" : "no"} />
        </div>
      </section>

      {result && (
        <section className="space-y-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Last test</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KV k="Server" v={`${result.server.chosen.provider} ${result.server.chosen.city ?? ""}`} mono={false} />
            <KV k="Median latency to server" v={`${Math.round(result.server.chosen.latency.median)} ms`} />
            <KV k="IPv4 reachable" v={result.preflight.ipv4} />
            <KV k="IPv6 reachable" v={result.preflight.ipv6} />
          </div>
        </section>
      )}

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">Devices on your network</CardTitle>
            <Badge variant="outline" className="text-muted-foreground">Requires NetPulse Companion</Badge>
          </div>
          <CardDescription>
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
