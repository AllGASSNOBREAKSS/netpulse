import { useEffect, useRef, useState } from "react";
import { pingOnce } from "../lib/engine";

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
            Probes the network every 500&nbsp;ms and watches for spikes and drops. Leave it
            running while you game or join a call — if something stutters, the strip below
            catches it.
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
   Vulnerabilities / exposure — real data where the browser can get it,
   honest "requires more" everywhere else. No fabricated findings.
   ============================================================================ */
type TraceInfo = Record<string, string>;

export function Vulnerabilities() {
  const [trace, setTrace] = useState<TraceInfo | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch("https://speed.cloudflare.com/cdn-cgi/trace")
      .then((r) => r.text())
      .then((t) => {
        const info: TraceInfo = {};
        for (const line of t.trim().split("\n")) {
          const [k, v] = line.split("=");
          if (k && v) info[k] = v;
        }
        setTrace(info);
      })
      .catch(() => setFailed(true));
  }, []);

  return (
    <div className="panel">
      <h1 className="panel__title">Exposure & vulnerabilities</h1>
      <p className="panel__sub">
        What the outside world can see about your connection right now — measured live, not
        guessed. Deeper checks are on the roadmap below.
      </p>

      <div className="stat-row">
        <Stat label="public IP" value={trace?.ip ?? (failed ? "unavailable" : "…")} />
        <Stat label="nearest edge" value={trace?.colo ?? (failed ? "—" : "…")} />
        <Stat label="TLS" value={trace?.tls ?? (failed ? "—" : "…")} />
        <Stat label="HTTP" value={trace?.http ?? (failed ? "—" : "…")} />
        <Stat label="WARP/VPN (CF)" value={trace ? (trace.warp === "on" ? "on" : "off") : failed ? "—" : "…"} />
      </div>

      <p className="panel__note">
        Your public IP is visible to every site you visit — that's normal. What matters is
        what's behind it: router firmware, open ports, and leaked credentials.
      </p>

      <h2 className="panel__h2">Coming next</h2>
      <div className="soon-grid">
        <Soon title="Password breach check" what="Check whether your email or passwords appear in known data breaches — hashed lookups, nothing stored." />
        <Soon title="Router health" what="Detect router model + firmware age and flag known CVEs. Needs the companion app — browsers can't reach your router." />
        <Soon title="DNS security" what="Test whether your DNS is encrypted (DoH/DoT) and who actually answers your lookups." />
        <Soon title="ISP outage radar" what="See whether your provider (Optimum, Verizon, Xfinity…) has reported problems in your area right now." />
      </div>
    </div>
  );
}

/* ============================================================================
   Connections — honest: a browser cannot enumerate LAN devices. Explain,
   and show the plan.
   ============================================================================ */
export function Connections() {
  return (
    <div className="panel">
      <h1 className="panel__title">Connections</h1>
      <p className="panel__sub">
        Who's on your Wi-Fi, and how much of it they're using.
      </p>

      <div className="honest">
        <strong>Straight answer:</strong> a web page is sandboxed — it cannot scan your network,
        list connected devices, or read router tables. Any website claiming to show "devices on
        your Wi-Fi" from the browser alone is guessing. This page will light up when the
        NetPulse companion app ships; until then we'd rather show you nothing than show you
        fiction.
      </div>

      <h2 className="panel__h2">What this page will do</h2>
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
