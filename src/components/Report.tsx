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
            Estimated: ~{preflight.estimatedDurationSec}s · typically ~{preflight.estimatedDataMB} MB · configured cap {preflight.estimatedDataMaxMB} MB before in-flight overshoot
          </div>
        )}
      </div>

      {server && (
        <div className="pf__group">
          <div className="pf__h">Server {server.manual && <span className="pf__manual">manual</span>}</div>
          <div className="pf__chips">
            <Chip k="Provider" v={server.chosen.provider} />
            <Chip k="Region" v={server.chosen.regionLabel} />
            {server.chosen.edgeCode && <Chip k="Edge code" v={server.chosen.edgeCode} />}
            {server.chosen.clientCountryCode && <Chip k="Client country" v={server.chosen.clientCountryCode} />}
            <Chip k="Protocol" v={server.chosen.protocol} />
            <Chip k="IP" v={server.chosen.ipFamily} />
            <Chip k="Latency" v={`${Math.round(server.chosen.latency.median)} ms`} />
            <Chip k="Server city" v={server.chosen.city ?? "unavailable"} />
            <Chip k="Distance" v={server.chosen.approximateDistanceKm === null ? "unavailable" : `${server.chosen.approximateDistanceKm} km`} />
            <Chip k="Health" v={server.chosen.healthStatus} warn={server.chosen.healthStatus !== "healthy"} title={server.chosen.healthReason} />
            <Chip k="Load" v={server.chosen.loadPct === null ? "unavailable" : `${Math.round(server.chosen.loadPct)}%`} />
            <Chip k="Capacity" v={server.chosen.availableCapacityMbps === null ? "unavailable" : `${Math.round(server.chosen.availableCapacityMbps)} Mbps free`} />
            <Chip k="Version" v={server.chosen.serverVersion ?? "unavailable"} />
          </div>
          <div className="pf__reason">{server.reason}</div>
          <div className="pf__est">
            {server.degraded ? "Degraded selection: " : "Backups ready: "}
            {server.backups.length > 0 ? server.backups.map((backup) => `${backup.regionLabel} (${backup.provider})`).join(", ") : "no independently reachable backup endpoint"}.
            {" "}{server.coverage.filter((region) => region.status === "supported" || region.status === "pilot").length} requested region(s) currently supported or in pilot; {server.coverage.filter((region) => region.status === "planned" || region.status === "unsupported").length} remain unavailable.
          </div>
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
                {r.penalty > 0 && <span className="conf__penalty"> −{r.penalty} points</span>}
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
            <tr><td className="mi__range">Run</td><td>{result.runId} · schema {result.schemaVersion} · engine {result.engineVersion} · method {result.methodologyVersion}</td></tr>
            <tr><td className="mi__range">Endpoint directory</td><td>{result.server.directoryRevision} · {result.server.directorySource}{result.server.directoryWarning ? ` · ${result.server.directoryWarning}` : ""}</td></tr>
            <tr><td className="mi__range">Operational telemetry</td><td>health {result.server.chosen.healthStatus} · load {result.server.chosen.loadPct === null ? "unavailable" : `${Math.round(result.server.chosen.loadPct)}%`} · capacity headroom {result.server.chosen.availableCapacityMbps === null ? "unavailable" : `${Math.round(result.server.chosen.availableCapacityMbps)} Mbps`} · version {result.server.chosen.serverVersion ?? "unavailable"}</td></tr>
            <tr><td className="mi__range">Failover candidates</td><td>{result.server.backups.length ? result.server.backups.map((backup) => `${backup.regionLabel} (${backup.provider})`).join(", ") : "none reachable"}</td></tr>
            <tr><td className="mi__range">Server</td><td>{result.server.chosen.provider} · edge {result.server.chosen.edgeCode ?? "unknown"} · {result.server.chosen.protocol}</td></tr>
            <tr><td className="mi__range">Mode</td><td>{result.lowData ? "Low-data" : "Full"}</td></tr>
            <tr><td className="mi__range">IP family</td><td>{result.ispLocation.ipFamily} · {result.ispLocation.ipMasked}</td></tr>
            <tr><td className="mi__range">IPv4 / IPv6 comparison</td><td>{result.preflight.ipComparison.reason}</td></tr>
            <tr><td className="mi__range">Transport telemetry</td><td>browser {result.transportTelemetry.browserProtocol ?? "unavailable"} · server {result.transportTelemetry.serverTransport} · TCP RTT {result.transportTelemetry.serverReportedTcpRttMs ?? "unavailable"} · QUIC RTT {result.transportTelemetry.serverReportedQuicRttMs ?? "unavailable"} · retransmits {result.transportTelemetry.serverReportedRetransmits ?? "unavailable"}</td></tr>
            <tr><td className="mi__range">Secondary verification</td><td>{result.accuracyPassport.secondaryVerification.reason}</td></tr>
            <tr><td className="mi__range">Echo / packet loss</td><td>{result.packetLoss.note}</td></tr>
            <tr><td className="mi__range">Payload transferred</td><td>{result.dataUsedMB.toFixed(1)} MB including discarded warm-ups, in {(result.durationMs / 1000).toFixed(1)} s</td></tr>
            <tr><td className="mi__range">Download phase</td><td>{(result.download.multi.durationMs / 1000).toFixed(2)} s · {formatBytes(result.download.multi.bytes + result.download.multi.warmupBytes)} payload · {result.download.multi.samples.length} timed windows · P5 {result.download.multi.p5Mbps.toFixed(1)} / P95 {result.download.multi.p95Mbps.toFixed(1)} Mbps · {result.download.multi.streams} stream(s) · {result.download.multi.variationPct.toFixed(1)}% variation · stop: {result.download.multi.stopReason}</td></tr>
            <tr><td className="mi__range">Download requests</td><td>{formatBytes(result.download.multi.requestBytes)} adaptive payload · warm-up {result.download.multi.warmupSucceeded ? "completed" : "failed"}</td></tr>
            <tr><td className="mi__range">Upload phase</td><td>{(result.upload.durationMs / 1000).toFixed(2)} s · {formatBytes(result.upload.bytes + result.upload.warmupBytes)} payload · {result.upload.samples.length} successful observations · P5 {result.upload.p5Mbps.toFixed(1)} / P95 {result.upload.p95Mbps.toFixed(1)} Mbps · {result.upload.streams} stream(s) · {result.upload.variationPct.toFixed(1)}% observed variation · stop: {result.upload.stopReason}</td></tr>
            <tr><td className="mi__range">Upload requests</td><td>{formatBytes(result.upload.requestBytes)} adaptive payload · warm-up {result.upload.warmupSucceeded ? "completed" : "failed"}</td></tr>
            <tr><td className="mi__range">Raw evidence</td><td>{result.samples.length} measurement samples · {result.rawEvidence.events.length} typed events · {result.rawEvidence.phases.length} phase attempts · retained locally for the latest 20 completed runs</td></tr>
          </tbody>
        </table>
      </section>

      <section className="mi">
        <h3 className="mi__h">Server candidates</h3>
        <table className="mi__bands">
          <tbody>
            {result.server.candidates.map((c) => (
              <tr key={c.id}>
                <td className="mi__range">{c.regionLabel} · {c.provider}</td>
                <td>
                  {c.available
                    ? `${Math.round(c.latency.median)} ms median · ${Math.round(c.latency.jitter)} ms jitter · ${c.attempted - c.failed}/${c.attempted} probes · health ${c.healthStatus} · load ${c.loadPct === null ? "unavailable" : `${Math.round(c.loadPct)}%`} · rank ${c.rank}`
                    : `unreachable · 0/${c.attempted} probes`}
                  {c.id === result.server.chosen.id ? " · chosen" : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mi">
        <h3 className="mi__h">Regional coverage</h3>
        <p className="mi__caption">Planned does not mean deployed. A region becomes selectable only after a real endpoint passes protocol, health, capacity, IPv4/IPv6, and independent route validation.</p>
        <table className="mi__bands">
          <tbody>
            {result.server.coverage.map((region) => (
              <tr key={region.id}>
                <td className="mi__range">{region.label}</td>
                <td>{region.status} · {region.note}</td>
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

function formatBytes(bytes: number): string {
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(2)} MB` : `${Math.round(bytes / 1000)} kB`;
}
