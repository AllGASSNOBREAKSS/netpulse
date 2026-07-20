import { useEffect, useRef, useState } from "react";
import { pingOnce } from "../lib/engine";
import { maskIp } from "../lib/ip";
import { coloDistanceKm, fetchMeta, type NetworkMeta } from "../lib/servers";

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
   Public IP is masked by default; reveal is a deliberate user action.
   ============================================================================ */
type TraceInfo = Record<string, string>;

export function ConnectionPrivacy() {
  const [trace, setTrace] = useState<TraceInfo | null>(null);
  const [meta, setMeta] = useState<NetworkMeta | null>(null);
  const [failed, setFailed] = useState(false);
  const [revealIp, setRevealIp] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const traceP = fetch("https://speed.cloudflare.com/cdn-cgi/trace")
      .then((r) => r.text())
      .then((t) => {
        if (cancelled) return;
        const info: TraceInfo = {};
        for (const line of t.trim().split("\n")) {
          const [k, v] = line.split("=");
          if (k && v) info[k] = v;
        }
        setTrace(info);
      });
    void fetchMeta(undefined).then((m) => {
      if (!cancelled) setMeta(m);
    });
    traceP.catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const rawIp = meta?.clientIp || trace?.ip || "";
  const ipDisplay = rawIp ? (revealIp ? rawIp : maskIp(rawIp)) : failed ? "unavailable" : "…";
  const dist = coloDistanceKm(meta);

  return (
    <div className="panel">
      <h1 className="panel__title">Connection &amp; Privacy</h1>
      <p className="panel__sub">
        What the outside world can see about your connection right now — read live from
        Cloudflare's edge view of your request. These are normal properties of every internet
        connection, <strong>not</strong> vulnerabilities.
      </p>

      <h2 className="panel__h2">Your connection</h2>
      <div className="stat-row">
        <div className="stat">
          <div className="stat__label">public IP</div>
          <div className="stat__value">{ipDisplay}</div>
          {rawIp && (
            <button className="stat__reveal" onClick={() => setRevealIp((v) => !v)}>
              {revealIp ? "mask" : "reveal"}
            </button>
          )}
        </div>
        <Stat label="ISP" value={meta?.org ?? (failed ? "—" : "…")} />
        <Stat label="ASN" value={meta?.asn != null ? `AS${meta.asn}` : failed ? "—" : "…"} />
        <Stat label="your location" value={meta?.city ? `${meta.city}, ${meta.region ?? ""}`.replace(/, $/, "") : "…"} />
        <Stat label="IP version" value={meta?.ipFamily ?? "…"} />
      </div>

      <h2 className="panel__h2">Test server &amp; route</h2>
      <div className="stat-row">
        <Stat label="edge (colo)" value={meta?.coloCity ? `${meta.coloCity} (${meta.colo})` : trace?.colo ?? "…"} />
        <Stat label="distance" value={dist != null ? `~${dist} km` : "—"} />
        <Stat label="TLS" value={trace?.tls ?? (failed ? "—" : "…")} />
        <Stat label="HTTP" value={trace?.http ?? (failed ? "—" : "…")} />
        <Stat label="Cloudflare WARP" value={trace ? (trace.warp === "on" ? "on" : "off") : failed ? "—" : "…"} />
      </div>

      <p className="panel__note">
        ISP, ASN and location come from Cloudflare's edge (`/meta`) — the same source
        speed.cloudflare.com uses. Location is approximate and reflects your network's routing
        region, often an ISP point of presence rather than your street address. Every site you
        visit already sees your public IP; NetPulse masks it by default so a screenshot doesn't
        leak it, and nothing on this page is sent anywhere or stored.
      </p>

      <h2 className="panel__h2">Planned checks (not yet available)</h2>
      <div className="soon-grid">
        <Soon title="Password breach check" what="Check whether your email appears in known data breaches — hashed lookups, nothing stored." />
        <Soon title="Router health" what="Detect router model + firmware age and flag known CVEs. Needs the companion app — browsers can't reach your router." />
        <Soon title="DNS security" what="Test whether your DNS is encrypted (DoH/DoT) and who actually answers your lookups." />
        <Soon title="ISP outage radar" what="See whether your provider has reported problems in your area right now." />
      </div>
    </div>
  );
}

/* ============================================================================
   Devices — honest: a browser cannot enumerate LAN devices. Explain,
   and show the plan.
   ============================================================================ */
export function Devices() {
  return (
    <div className="panel">
      <h1 className="panel__title">Devices</h1>
      <p className="panel__sub">Who's on your Wi-Fi, and how much of it they're using.</p>

      <div className="honest">
        <strong>Straight answer:</strong> a web page is sandboxed — it cannot scan your network,
        list connected devices, or read router tables. Any website claiming to show "devices on
        your Wi-Fi" from the browser alone is guessing. This page will light up when the
        NetPulse companion app ships; until then we'd rather show you nothing than show you
        fiction.
      </div>

      <h2 className="panel__h2">What this page will do (planned)</h2>
      <div className="soon-grid">
        <Soon title="Device list" what="Every device on your network — phones, TVs, consoles, unknown guests — with names and vendors." />
        <Soon title="Intruder alert" what="A device you've never seen joins your Wi-Fi → you get a notification." />
        <Soon title="Per-device usage" what="See which device is eating your bandwidth in real time." />
        <Soon title="Kick & block" what="One tap to boot a freeloader off your network (router-dependent)." />
      </div>
    </div>
  );
}

function Soon({ title, what }: { title: string; what: string }) {
  return (
    <div className="soon">
      <div className="soon__badge">planned</div>
      <div className="soon__title">{title}</div>
      <div className="soon__what">{what}</div>
    </div>
  );
}
