import { ArcAnimatedNumber, ArcFooter, ArcMeter, ArcSparkline } from "./ArcTelemetry";
import { AlertTriangle, Check, FileJson, RotateCcw, Save, Share2, Zap } from "lucide-react";
import type { Phase, TestResult } from "../lib/engine";
import type { HistoryEntry } from "../lib/history";
import type { MetricDef } from "../lib/metrics";
import type { Preflight, ServerSelection } from "../lib/types";
import type { Verdict } from "../lib/verdict";
import Speedometer from "./Speedometer";
import { ConfidencePanel } from "./Report";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui/card";
import { Separator } from "./ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

const MAIN_METRIC_IDS = new Set([
  "download",
  "upload",
  "idleLatency",
  "dlLoaded",
  "ulLoaded",
  "jitter",
  "packetLoss",
  "bufferbloat",
]);

export function HeroTestPanel({
  phase,
  running,
  lowData,
  liveMbps,
  peakMbps,
  idlePingMs,
  dataUsedMB,
  result,
  verdict,
  status,
  shareStatus,
  onStart,
  onScore,
  onShare,
}: {
  phase: Phase;
  running: boolean;
  lowData: boolean;
  liveMbps: number | null;
  peakMbps: number;
  idlePingMs?: number;
  dataUsedMB: number;
  result: TestResult | null;
  verdict: Verdict | null;
  status: string;
  shareStatus: string | null;
  onStart: () => void;
  onScore: () => void;
  onShare: () => void;
}) {
  const score = verdict?.score ?? 0;
  return (
    <Card className="hero-panel">
      <div className="hero-panel__score">
        <span className="section-kicker">Internet health</span>
        <button onClick={onScore} disabled={!verdict} className="health-score" aria-label="Open health score breakdown">
          {verdict ? <ArcAnimatedNumber value={score} decimals={0} suffix="/100" /> : <span>—</span>}
        </button>
        <ArcMeter value={score} low={50} high={75} optimum={100} label="Internet health score" className="health-meter" />
        <p>{verdict?.headline ?? "Run a live browser test to measure this connection."}</p>
      </div>
      <div className="hero-panel__gauge">
        <Speedometer
          liveMbps={liveMbps}
          peakMbps={peakMbps}
          phase={phase}
          idlePingMs={idlePingMs}
          dataUsedMB={dataUsedMB}
          finalScore={verdict?.score ?? null}
          lowData={lowData}
          onScoreClick={onScore}
        />
      </div>
      <div className="hero-panel__actions">
        <div className="test-stage" role="status" aria-live="polite">
          {running && <span className="pulse-dot" aria-hidden="true" />}
          <span>{status}</span>
        </div>
        <Button size="lg" onClick={onStart} disabled={running} className="hero-run">
          <RotateCcw aria-hidden="true" />
          {running ? "Testing…" : result ? "Run again" : "Start test"}
        </Button>
        <div className="result-actions" aria-label="Result actions">
          <Button variant="outline" size="sm" disabled={!result} title="Results are saved automatically on this device">
            {result ? <Check aria-hidden="true" /> : <Save aria-hidden="true" />}
            {result ? "Saved locally" : "Save"}
          </Button>
          <Button variant="outline" size="sm" disabled={!result} onClick={onShare}>
            <Share2 aria-hidden="true" />
            Share
          </Button>
        </div>
        {shareStatus && <p className="action-status" role="status">{shareStatus}</p>}
      </div>
    </Card>
  );
}

export function ConnectionIdentity({
  preflight,
  server,
  result,
}: {
  preflight: Preflight | null;
  server: ServerSelection | null;
  result: TestResult | null;
}) {
  const identity = result?.ispLocation;
  const chosen = result?.server.chosen ?? server?.chosen;
  const approximateArea = identity
    ? [identity.city, identity.region, identity.country].filter(Boolean).join(", ") || null
    : null;

  return (
    <Card className="result-section">
      <CardHeader>
        <CardTitle>Connection identity</CardTitle>
        <CardDescription>Only facts returned by the active test are shown. IP-based locations are approximate.</CardDescription>
      </CardHeader>
      <CardContent className="identity-grid">
        <IdentityItem label="ISP" value={identity?.ispHint} unavailable="Optional privacy lookup not run" />
        <IdentityItem label="ASN" value={identity?.asn} unavailable="Optional privacy lookup not run" />
        <IdentityItem label="Approximate region" value={approximateArea} unavailable="No location source available" />
        <IdentityItem label="Test-server edge" value={chosen?.edgeCode} unavailable="Edge code unavailable" />
        <IdentityItem label="Server provider" value={chosen?.provider} unavailable="Server not selected yet" />
        <IdentityItem label="IP version" value={identity?.ipFamily ?? chosen?.ipFamily} unavailable="Not detected" />
        <IdentityItem label="Possible VPN" value={identity?.vpnProxy ?? preflight?.vpnProxy} unavailable="Not assessed" />
        <IdentityItem
          label="Result confidence"
          value={result ? `${result.confidence.score}%` : null}
          unavailable="Available after a completed test"
        />
      </CardContent>
      <CardFooter className="identity-note">
        Server edge codes identify the provider edge that answered; they are not claimed as a physical server location.
      </CardFooter>
    </Card>
  );
}

function IdentityItem({ label, value, unavailable }: { label: string; value: string | null | undefined; unavailable: string }) {
  return (
    <div className="identity-item">
      <span>{label}</span>
      <strong>{value ?? "Unavailable"}</strong>
      {!value && <small>{unavailable}</small>}
    </div>
  );
}

export function MetricGrid({
  metrics,
  current,
  result,
  phase,
  running,
  onOpen,
}: {
  metrics: MetricDef[];
  current: Partial<TestResult>;
  result: TestResult | null;
  phase: Phase;
  running: boolean;
  onOpen: (id: string) => void;
}) {
  return (
    <section className="section-stack" aria-labelledby="metrics-title">
      <div className="section-heading">
        <div>
          <span className="section-kicker">Measured evidence</span>
          <h2 id="metrics-title">Main metrics</h2>
        </div>
        <p>Open any card for method, ranges, raw samples, limitations, and the next action.</p>
      </div>
      <div className="metric-grid">
        {metrics.filter((metric) => MAIN_METRIC_IDS.has(metric.id)).map((metric) => {
          const value = metric.value(current);
          const sub = metric.sub?.(current);
          const sampleSet = result && metric.samples ? metric.samples(result) : null;
          const secondary = sub ?? (result && sampleSet
            ? `${sampleSet.values.length} real sample${sampleSet.values.length === 1 ? "" : "s"}`
            : result
              ? "Calculated from this completed run"
              : "Awaiting a completed measurement");
          const hot = running && metric.hotPhase !== undefined && phase.startsWith(metric.hotPhase);
          return (
            <Card key={metric.id} size="sm" className="metric-card" data-hot={hot || undefined}>
              <button className="metric-card__button" onClick={() => onOpen(metric.id)}>
                <span className="metric-card__top">
                  <span>{metric.name}</span>
                  <Badge variant="outline" data-provenance={metric.unavailable ? "unavailable" : metric.provenance}>
                    {metric.unavailable ? "unavailable" : metric.provenance}
                  </Badge>
                </span>
                <strong>{value ?? (metric.unavailable && result ? "Unavailable" : "—")}</strong>
                <small>{secondary}</small>
                {sampleSet && sampleSet.values.length > 1 ? (
                  <ArcSparkline data={sampleSet.values} width={220} height={40} className="metric-sparkline" />
                ) : (
                  <span className="metric-sparkline metric-sparkline--empty" aria-hidden="true" />
                )}
              </button>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

export function DiagnosisPanel({ verdict }: { verdict: Verdict | null }) {
  return (
    <Card className="result-section">
      <CardHeader>
        <CardTitle>Evidence-based diagnosis</CardTitle>
        <CardDescription>Conclusions appear only after a completed run and stay tied to measured inputs.</CardDescription>
      </CardHeader>
      <CardContent>
        {!verdict ? (
          <div className="honest-empty">No diagnosis yet. NetPulse does not generate generic advice before measuring.</div>
        ) : (
          <div className="diagnosis-grid">
            <div>
              <h3><Check aria-hidden="true" /> What held up</h3>
              {verdict.good.length ? <ul className="evidence-list evidence-list--good">{verdict.good.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No strong signal cleared its healthy threshold.</p>}
            </div>
            <div>
              <h3><AlertTriangle aria-hidden="true" /> What needs attention</h3>
              {verdict.bad.length ? <ul className="evidence-list evidence-list--bad">{verdict.bad.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No material weakness was detected in this run.</p>}
            </div>
            <div className="diagnosis-actions">
              <h3><Zap aria-hidden="true" /> Highest-value next actions</h3>
              <ol>{verdict.actions.map((item) => <li key={item}>{item}</li>)}</ol>
              {verdict.dontBuy && <p className="dont-buy"><strong>Unlikely to help:</strong> {verdict.dontBuy}</p>}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ImpactPanel({ verdict, result }: { verdict: Verdict | null; result: TestResult | null }) {
  const find = (name: string) => verdict?.activities.find((activity) => activity.name === name);
  const categories = [
    { key: "gaming", title: "Gaming", entries: [find("Competitive gaming"), find("Gaming while others download")] },
    { key: "streaming", title: "Streaming", entries: [find("4K streaming"), find("Cloud gaming")] },
    { key: "work", title: "Work and video calls", entries: [find("Video calls")] },
    { key: "uploading", title: "Uploading", entries: [find("Livestreaming"), find("Large uploads / backups")] },
    { key: "browsing", title: "Browsing", entries: [find("Everyday browsing")] },
  ];

  return (
    <Card className="result-section">
      <CardHeader>
        <CardTitle>Real-world impact</CardTitle>
        <CardDescription>Ratings are calculated from the completed test; they are not device or application telemetry.</CardDescription>
      </CardHeader>
      <CardContent>
        {!verdict ? <div className="honest-empty">Complete a test to calculate impact ratings.</div> : (
          <Accordion type="multiple" defaultValue={["gaming", "work"]}>
            {categories.map((category) => (
              <AccordionItem value={category.key} key={category.key}>
                <AccordionTrigger>{category.title}</AccordionTrigger>
                <AccordionContent>
                  <div className="impact-list">
                    {category.entries.filter((entry) => entry !== undefined).map((entry) => (
                      <div key={entry.name} className="impact-row">
                        <Badge data-grade={entry.grade.toLowerCase()}>{entry.grade}</Badge>
                        <span><strong>{entry.name}</strong><small>{entry.note}</small></span>
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
            <AccordionItem value="smart-home">
              <AccordionTrigger>Smart-home devices</AccordionTrigger>
              <AccordionContent>
                <p className="impact-limitation">
                  NetPulse cannot see, count, or identify devices on your local network. {result
                    ? `This connection’s loaded latency was ${Math.round(Math.max(result.loadedDownPingMs, result.loadedUpPingMs))} ms, which is useful connection-level context but not a smart-device test.`
                    : "Run a test for connection-level context; no device inventory will be inferred."}
                </p>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        )}
      </CardContent>
    </Card>
  );
}

export function RawDataPanel({
  result,
  onScore,
  onMethod,
}: {
  result: TestResult | null;
  onScore: () => void;
  onMethod: () => void;
}) {
  if (!result) return null;
  return (
    <Card className="result-section raw-panel">
      <CardHeader>
        <CardTitle>Raw technical data</CardTitle>
        <CardDescription>{result.samples.length} stored events · {(result.durationMs / 1000).toFixed(1)} s · {result.dataUsedMB.toFixed(0)} MB measured payload</CardDescription>
      </CardHeader>
      <CardContent><ConfidencePanel confidence={result.confidence} /></CardContent>
      <CardFooter className="raw-panel__actions">
        <Button variant="outline" onClick={onScore}>Scoring breakdown</Button>
        <Button variant="outline" onClick={onMethod}><FileJson aria-hidden="true" /> Methodology and JSON</Button>
      </CardFooter>
    </Card>
  );
}

export function HistoryView({ history, onClear }: { history: HistoryEntry[]; onClear: () => void }) {
  return (
    <Card className="page-card">
      <CardHeader className="history-heading">
        <div><CardTitle>Test history</CardTitle><CardDescription>Saved locally on this device. Nothing is uploaded.</CardDescription></div>
        {history.length > 0 && <Button variant="outline" size="sm" onClick={onClear}>Clear all</Button>}
      </CardHeader>
      <CardContent>
        {history.length === 0 ? <div className="honest-empty">No tests yet. Run one from Speed Test.</div> : (
          <Table>
            <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Score</TableHead><TableHead>Download</TableHead><TableHead>Upload</TableHead><TableHead>Ping</TableHead><TableHead>Bloat</TableHead><TableHead>Confidence</TableHead></TableRow></TableHeader>
            <TableBody>{history.slice(0, 20).map((entry) => (
              <TableRow key={entry.ts}>
                <TableCell>{new Date(entry.ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</TableCell>
                <TableCell>{entry.score}</TableCell>
                <TableCell>{formatSpeed(entry.down)} Mbps</TableCell>
                <TableCell>{formatSpeed(entry.up)} Mbps</TableCell>
                <TableCell>{Math.round(entry.ping)} ms</TableCell>
                <TableCell>{entry.grade}</TableCell>
                <TableCell>{entry.confidence !== undefined ? `${entry.confidence}%` : "—"}</TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function formatSpeed(value: number): string {
  return value >= 100 ? String(Math.round(value)) : value.toFixed(1);
}

export function NetPulseFooter() {
  return (
    <ArcFooter className="netpulse-footer">
      <div slot="logo" className="footer-brand">net<span>pulse</span></div>
      <div>
        Browser measurements use live HTTPS requests to the selected provider edge. Different test endpoints and methods can produce different results.
      </div>
      <div slot="social"><a href="https://github.com/bbarc0de/netpulse" target="_blank" rel="noreferrer">GitHub</a></div>
      <div slot="legal" className="footer-legal">
        <Separator />
        <p>© 2026 NetPulse and contributors.</p>
        <p>Open-source software licensed under AGPL-3.0.</p>
        <p>NetPulse is an independent project and is not affiliated with Ookla, Netflix, Speedtest, or FAST.com.</p>
      </div>
    </ArcFooter>
  );
}
