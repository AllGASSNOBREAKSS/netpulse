import { useEffect, useRef, useState } from "react";
import { pingOnce } from "../lib/engine";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { maskIp } from "../lib/ip";
import { lookupNetworkIdentity, type NetworkIdentity } from "../lib/networkIdentity";

/* ============================================================================
   Latency Monitor — real continuous probes, start/stop, live stats.
   ============================================================================ */
type Probe = { t: number; rtt: number | null };

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function LatencyMonitor() {
  const [probes, setProbes] = useState<Probe[]>([]);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);

  useEffect(() => {
    runningRef.current = running;
    if (!running) return;
    let cancelled = false;
    (async () => {
      while (!cancelled && runningRef.current) {
        const rtt = await pingOnce();
        if (cancelled) break;
        setProbes((prev) => [...prev.slice(-119), { t: Date.now(), rtt }]);
        await new Promise((r) => setTimeout(r, 500));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [running]);

  const ok = probes.filter((p) => p.rtt !== null).map((p) => p.rtt as number);
  const med = median(ok);
  const worst = ok.length ? Math.max(...ok) : 0;
  const best = ok.length ? Math.min(...ok) : 0;
  const failed = probes.filter((p) => p.rtt === null).length;
  const spikes = ok.filter((r) => med > 0 && r > Math.max(med * 3, med + 150)).length;
  const barMax = Math.max(worst, 100);

  return (
    <div className="panel">
      <div className="panel__head">
        <div>
          <h1 className="panel__title">Latency monitor</h1>
          <p className="panel__sub">
            Sends a timed HTTPS probe to the nearest Cloudflare edge every 500&nbsp;ms and
            watches for spikes and drops. Leave it running while you game or join a call — if
            something stutters, the strip below catches it.
          </p>
        </div>
        <button className="runbtn runbtn--small" onClick={() => setRunning((r) => !r)}>
          {running ? "Stop" : "Start monitoring"}
        </button>
      </div>

      <div className="stat-row">
        <Stat label="median" value={ok.length ? `${Math.round(med)}ms` : "—"} />
        <Stat label="best" value={ok.length ? `${Math.round(best)}ms` : "—"} />
        <Stat label="worst" value={ok.length ? `${Math.round(worst)}ms` : "—"} accent={worst > 200} />
        <Stat label="spikes" value={String(spikes)} accent={spikes > 0} />
        <Stat label="failed probes" value={String(failed)} accent={failed > 0} />
        <Stat label="samples" value={String(probes.length)} />
      </div>

      <div className="lat-strip" aria-label="Recent latency probes">
        {probes.map((p, i) =>
          p.rtt === null ? (
            <span key={i} className="lat-bar lat-bar--fail" style={{ height: "100%" }} title="probe failed" />
          ) : (
            <span
              key={i}
              className={`lat-bar ${med > 0 && p.rtt > Math.max(med * 3, med + 150) ? "lat-bar--spike" : ""}`}
              style={{ height: `${Math.max((p.rtt / barMax) * 100, 4)}%` }}
              title={`${Math.round(p.rtt)}ms`}
            />
          ),
        )}
        {probes.length === 0 && <span className="lat-empty">Press start — bars appear here as probes return.</span>}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value" data-accent={accent || undefined}>
        {value}
      </div>
    </div>
  );
}

/* ============================================================================
   Connection & Privacy — neutral facts about what the outside world sees.
   These are properties of every internet connection, not vulnerabilities.
   Auto section uses only the measurement provider's trace (already contacted
   for tests). The ISP/area lookup is opt-in and clearly disclosed.
   ============================================================================ */
type TraceInfo = Record<string, string>;

function PrivacyRow({ k, v, action }: { k: string; v: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-1.5">
      <dt className="shrink-0 text-[13px] text-muted-foreground">{k}</dt>
      <dd className="flex min-w-0 items-baseline gap-2 text-right font-mono text-[13.5px] font-medium">
        <span className="truncate" title={v}>{v}</span>
        {action}
      </dd>
    </div>
  );
}

export function ConnectionPrivacy() {
  const [trace, setTrace] = useState<TraceInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [revealIp, setRevealIp] = useState(false);
  const [identity, setIdentity] = useState<NetworkIdentity | null>(null);
  const [lookupState, setLookupState] = useState<"idle" | "loading" | "error">("idle");

  useEffect(() => {
    let cancelled = false;
    fetch("https://speed.cloudflare.com/cdn-cgi/trace", { cache: "no-store" })
      .then((r) => r.text())
      .then((t) => {
        if (cancelled) return;
        const info: TraceInfo = {};
        for (const line of t.trim().split("\n")) {
          const [k, v] = line.split("=");
          if (k && v) info[k] = v;
        }
        setTrace(info);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const runLookup = async () => {
    setLookupState("loading");
    try {
      setIdentity(await lookupNetworkIdentity());
      setLookupState("idle");
    } catch {
      setLookupState("error");
    }
  };

  const rawIp = trace?.ip ?? "";
  const ipDisplay = rawIp ? (revealIp ? rawIp : maskIp(rawIp)) : failed ? "unavailable" : "…";
  const pend = failed ? "unavailable" : "…";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Connection &amp; Privacy</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          What the outside world can see about your connection right now. These are normal
          properties of every internet connection, <strong>not</strong> vulnerabilities.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-1">
          <CardTitle className="text-[15px]">Public internet identity</CardTitle>
          <CardDescription>
            Read from the measurement provider's echo of your own request — no extra parties are
            contacted, nothing is stored.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="divide-y divide-border/60">
            <PrivacyRow
              k="Public IP"
              v={ipDisplay}
              action={
                rawIp ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-[10px] uppercase tracking-wider"
                    onClick={() => setRevealIp((x) => !x)}
                  >
                    {revealIp ? "mask" : "reveal"}
                  </Button>
                ) : undefined
              }
            />
            <PrivacyRow k="Serving edge" v={trace?.colo ?? pend} />
            <PrivacyRow k="TLS version" v={trace?.tls ?? pend} />
            <PrivacyRow k="HTTP version" v={trace?.http ?? pend} />
            <PrivacyRow k="Cloudflare WARP" v={trace ? (trace.warp === "on" ? "on" : "off") : pend} />
          </dl>
          <p className="mt-3 text-[12.5px] leading-relaxed text-muted-foreground">
            Every site you visit already sees your public IP — that's how the internet routes
            replies. NetPulse masks it by default so a screenshot or screen-share doesn't leak it.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-1">
          <CardTitle className="text-[15px]">ISP &amp; approximate area</CardTitle>
          <CardDescription>
            Optional lookup via ipwho.is. Running it discloses your public IP to that service, so
            it only happens when you ask — results are registry estimates, never a street address,
            and are not saved to history or exports.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {identity ? (
            <dl className="divide-y divide-border/60">
              <PrivacyRow k="ISP" v={identity.isp ?? "unknown"} />
              <PrivacyRow k="ASN" v={identity.asn ?? "unknown"} />
              <PrivacyRow k="Approx. area" v={[identity.city, identity.region, identity.country].filter(Boolean).join(", ") || "unknown"} />
              <PrivacyRow k="IP family" v={identity.ipFamily} />
              <PrivacyRow k="Source" v={identity.source} />
            </dl>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" onClick={() => void runLookup()} disabled={lookupState === "loading"} className="gap-1.5">
                <Search className="size-3.5" />
                {lookupState === "loading" ? "Looking up…" : "Run optional lookup"}
              </Button>
              {lookupState === "error" && (
                <span className="text-[12.5px] text-status-warn">Lookup failed or timed out — try again.</span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-1">
          <CardTitle className="text-[15px]">Data handling</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-y divide-border/60">
            <PrivacyRow k="Backend / accounts" v="none — fully client-side" />
            <PrivacyRow k="Analytics / trackers" v="none" />
            <PrivacyRow k="Test history" v="localStorage on this device only" />
            <PrivacyRow k="Exports & shared reports" v="masked IP only, never the full address" />
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
