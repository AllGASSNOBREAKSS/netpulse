import { useEffect, useRef, useState } from "react";
import { maskIp } from "../lib/ip";
import { lookupNetworkIdentity, type NetworkIdentity } from "../lib/networkIdentity";

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
  const [failed, setFailed] = useState(false);
  const [revealIp, setRevealIp] = useState(false);
  const [identity, setIdentity] = useState<NetworkIdentity | null>(null);
  const [lookupState, setLookupState] = useState<"idle" | "loading" | "failed">("idle");
  const mountedRef = useRef(true);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    fetch("https://speed.cloudflare.com/cdn-cgi/trace", { cache: "no-store", signal: ctrl.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`Cloudflare trace returned HTTP ${r.status}.`);
        return r.text();
      })
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
      })
      .finally(() => {
        clearTimeout(timer);
      });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      ctrl.abort();
    };
  }, []);

  const lookupIdentity = async () => {
    setLookupState("loading");
    try {
      const next = await lookupNetworkIdentity();
      if (!mountedRef.current) return;
      setIdentity(next);
      setLookupState("idle");
    } catch (error) {
      if (!mountedRef.current) return;
      console.warn("NetPulse could not retrieve optional network metadata.", error);
      setLookupState("failed");
    }
  };

  const ipDisplay = trace?.ip ? (revealIp ? trace.ip : maskIp(trace.ip)) : failed ? "unavailable" : "…";

  return (
    <div className="panel">
      <h1 className="panel__title">Connection &amp; Privacy</h1>
      <p className="panel__sub">
        What the outside world can see about your connection right now — read live from the
        test server's echo of your request. These are normal properties of every internet
        connection, <strong>not</strong> vulnerabilities.
      </p>

      <div className="stat-row">
        <div className="stat">
          <div className="stat__label">public IP</div>
          <div className="stat__value">{ipDisplay}</div>
          {trace?.ip && (
            <button className="stat__reveal" onClick={() => setRevealIp((v) => !v)}>
              {revealIp ? "mask" : "reveal"}
            </button>
          )}
        </div>
        <Stat label="nearest edge" value={trace?.colo ?? (failed ? "—" : "…")} />
        <Stat label="TLS" value={trace?.tls ?? (failed ? "—" : "…")} />
        <Stat label="HTTP" value={trace?.http ?? (failed ? "—" : "…")} />
        <Stat label="Cloudflare WARP" value={trace ? (trace.warp === "on" ? "on" : "off") : failed ? "—" : "…"} />
      </div>

      <p className="panel__note">
        Every site you visit sees your public IP — that's how the internet routes replies.
        NetPulse masks it by default so a screenshot or screen-share doesn't leak it. This panel
        contacts Cloudflare for the facts above; NetPulse does not store them or send them to its
        own backend.
      </p>

      <section className="identity-lookup">
        <h2 className="verdict__h">Optional ISP &amp; approximate location</h2>
        <p className="panel__note">
          This lookup contacts <code>ipwho.is</code>, which will see the public IP making the request.
          It returns registry/geolocation estimates—not a precise address—and NetPulse immediately
          masks the IP. Nothing is saved to history. Run it only if you want this enrichment.
        </p>
        <button
          className="runbtn runbtn--small"
          onClick={() => void lookupIdentity()}
          disabled={lookupState === "loading"}
        >
          {lookupState === "loading" ? "Looking up…" : identity ? "Refresh lookup" : "Look up ISP & location"}
        </button>
        {lookupState === "failed" && (
          <p className="panel__note" role="status">Lookup unavailable. No ISP, ASN, or city is being claimed.</p>
        )}
        {identity && (
          <>
            <div className="stat-row">
              <Stat label="ISP estimate" value={identity.isp ?? "unavailable"} />
              <Stat label="ASN" value={identity.asn ?? "unavailable"} />
              <Stat label="organization" value={identity.organization ?? "unavailable"} />
              <Stat label="approx. area" value={formatApproximateArea(identity)} />
              <Stat label="IP family" value={identity.ipFamily} />
              <Stat label="masked IP" value={identity.ipMasked} />
            </div>
            <p className="panel__note">Source: {identity.source}. Values are IP registry/geolocation estimates.</p>
          </>
        )}
      </section>

      <p className="panel__note">
        NetPulse deliberately does not claim to inspect router firmware, enumerate LAN devices,
        detect password breaches, or verify DNS encryption from this page. Those checks require
        router access, user-provided account data, or a cooperating diagnostic service.
      </p>
    </div>
  );
}

function formatApproximateArea(identity: NetworkIdentity): string {
  const area = [identity.city, identity.region, identity.country ?? identity.countryCode].filter(Boolean);
  return area.length ? area.join(", ") : "unavailable";
}
