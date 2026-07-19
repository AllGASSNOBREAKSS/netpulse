import { useState } from "react";
import Modal from "./Modal";
import { buildExport, downloadJson, METHODOLOGY } from "../lib/export";
import type { Confidence, Preflight, ServerSelection, TestResult, TriState } from "../lib/types";
import type { Verdict } from "../lib/verdict";

const tri = (t: TriState) => (t === "yes" ? "yes" : t === "no" ? "no" : "unknown");

/** Compact preflight + chosen-server summary shown on the speed view. */
export function PreflightServer({
  preflight,
  server,
  preOnly,
}: {
  preflight: Preflight | null;
  server: ServerSelection | null;
  preOnly?: boolean;
}) {
  if (!preflight) return null;
  return (
    <section className="pf">
      <div className="pf__group">
        <div className="pf__h">Preflight</div>
        <div className="pf__chips">
          <Chip k="Browser" v={preflight.browser} />
          <Chip k="OS" v={preflight.os} />
          <Chip k="Device" v={preflight.deviceClass} />
          <Chip k="Tab" v={preflight.tabForeground ? "foreground" : "background"} warn={!preflight.tabForeground} />
          <Chip k="Secure" v={preflight.secureContext ? "yes" : "no"} />
          <Chip k="IPv4" v={tri(preflight.ipv4)} />
          <Chip k="IPv6" v={tri(preflight.ipv6)} />
          {preflight.connectionType && <Chip k="Conn" v={preflight.connectionType} />}
          <Chip
            k="VPN/proxy"
            v={preflight.vpnProxy}
            warn={preflight.vpnProxy === "possible"}
            title={preflight.vpnProxyReason}
          />
        </div>
        {preOnly && (
          <div className="pf__est">
            Estimated: ~{preflight.estimatedDurationSec}s · ~{preflight.estimatedDataMB} MB
          </div>
        )}
      </div>

      {server && (
        <div className="pf__group">
          <div className="pf__h">Server {server.manual && <span className="pf__manual">manual</span>}</div>
          <div className="pf__chips">
            <Chip k="Provider" v={server.chosen.provider} />
            {server.chosen.city && <Chip k="Edge" v={server.chosen.city} />}
            {server.chosen.region && <Chip k="Region" v={server.chosen.region} />}
            {server.chosen.approxDistanceKm != null && <Chip k="Distance" v={`~${server.chosen.approxDistanceKm} km`} />}
            <Chip k="Protocol" v={server.chosen.protocol} />
            <Chip k="IP" v={server.chosen.ipFamily} />
            <Chip k="Latency" v={`${Math.round(server.chosen.latency.median)} ms`} />
          </div>
          <div className="pf__reason">{server.reason}</div>
        </div>
      )}
    </section>
  );
}

function Chip({ k, v, warn, title }: { k: string; v: string; warn?: boolean; title?: string }) {
  return (
    <span className="chip" data-warn={warn || undefined} title={title}>
      <span className="chip__k">{k}</span>
      <span className="chip__v">{v}</span>
    </span>
  );
}

/** Result-confidence card with an expandable reason list. */
export function ConfidencePanel({ confidence }: { confidence: Confidence }) {
  const [open, setOpen] = useState(false);
  const tone = confidence.score >= 85 ? "good" : confidence.score >= 60 ? "fair" : "poor";
  return (
    <div className="conf">
      <div className="conf__head">
        <div>
          <div className="conf__label">Result confidence</div>
          <div className={`conf__score conf__score--${tone}`}>{confidence.score}%</div>
        </div>
        <button className="conf__toggle" onClick={() => setOpen((o) => !o)}>
          {open ? "hide" : "why?"}
        </button>
      </div>
      <p className="conf__summary">{confidence.summary}</p>
      {open && (
        <ul className="conf__reasons">
          {confidence.reasons.map((r) => (
            <li key={r.label} data-ok={r.ok}>
              <span className="conf__dot">{r.ok ? "✓" : "!"}</span>
              <span>
                <strong>{r.label}:</strong> {r.detail}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Methodology, server candidates, limitations, raw data, and export. */
export function MethodologyModal({
  result,
  verdict,
  onClose,
}: {
  result: TestResult;
  verdict: Verdict | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(buildExport(result, verdict), null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Modal title="Methodology & raw data" onClose={onClose}>
      <section className="mi">
        <h3 className="mi__h">Test configuration</h3>
        <table className="mi__bands">
          <tbody>
            <tr><td className="mi__range">Server</td><td>{result.server.chosen.provider} · {result.server.chosen.city ?? "?"} · {result.server.chosen.protocol}</td></tr>
            <tr><td className="mi__range">Mode</td><td>{result.lowData ? "Low-data" : "Full"}</td></tr>
            <tr><td className="mi__range">IP family</td><td>{result.ispLocation.ipFamily} · {result.ispLocation.ipMasked}</td></tr>
            <tr><td className="mi__range">Data moved</td><td>{result.dataUsedMB.toFixed(0)} MB in {(result.durationMs / 1000).toFixed(1)} s</td></tr>
            <tr><td className="mi__range">Raw samples</td><td>{result.samples.length} events stored</td></tr>
          </tbody>
        </table>
      </section>

      <section className="mi">
        <h3 className="mi__h">Server candidates</h3>
        <table className="mi__bands">
          <tbody>
            {result.server.candidates.map((c) => (
              <tr key={c.id}>
                <td className="mi__range">{c.provider}</td>
                <td>
                  {c.available ? `${Math.round(c.latency.median)} ms median · rank ${c.rank}` : "unreachable"}
                  {c.id === result.server.chosen.id ? " · chosen" : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mi">
        <h3 className="mi__h">Known limitations for this run</h3>
        <ul className="diag diag--bad">
          {result.limitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </section>

      <section className="mi">
        <h3 className="mi__h">Methodology</h3>
        {METHODOLOGY.map((p, i) => (
          <p key={i} style={{ marginBottom: 8 }}>
            {p}
          </p>
        ))}
      </section>

      <section className="mi">
        <h3 className="mi__h">Export</h3>
        <p className="mi__caption">
          Full JSON: config, server candidates, per-metric stats, raw samples, scoring formula, and methodology. The
          full public IP is never included.
        </p>
        <div className="export-btns">
          <button className="runbtn runbtn--small" onClick={copy}>
            {copied ? "Copied ✓" : "Copy JSON"}
          </button>
          <button className="runbtn runbtn--small" onClick={() => downloadJson(result, verdict)}>
            Download .json
          </button>
        </div>
      </section>
    </Modal>
  );
}
