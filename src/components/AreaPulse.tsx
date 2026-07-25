import { AlertTriangle, CheckCircle2, ExternalLink, Flag, Globe2, MapPin, RadioTower, RefreshCw, ShieldCheck, Trash2, WifiOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { areaReportLabel, type AreaPulseContext, type AreaPulseReportInput, type AreaPulseSnapshot, type AreaReportKind } from "../lib/areaPulse";
import { collectAreaReachability, deleteAreaPulseReport, loadAreaPulseContext, loadAreaPulseSnapshot, loadSavedAreaReports, submitAreaPulseAbuseReport, submitAreaPulseReport, type ReachabilityCheck, type SavedAreaReport } from "../lib/areaPulseClient";
import type { TestResult } from "../lib/engine";
import { TurnstileWidget } from "./TurnstileWidget";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui/card";
import { Checkbox } from "./ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Textarea } from "./ui/textarea";

const REPORT_KINDS: AreaReportKind[] = ["complete_outage", "intermittent", "slow_speed", "high_latency", "dns_problem", "service_unavailable"];

export function AreaPulse({ result }: { result: TestResult | null }) {
  const [context, setContext] = useState<AreaPulseContext | null>(null);
  const [snapshot, setSnapshot] = useState<AreaPulseSnapshot | null>(null);
  const [reachability, setReachability] = useState<ReachabilityCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [savedReports, setSavedReports] = useState<SavedAreaReport[]>(loadSavedAreaReports);
  const [flaggedIncident, setFlaggedIncident] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const nextContext = await loadAreaPulseContext(controller.signal);
      setContext(nextContext);
      const [checks, nextSnapshot] = await Promise.all([
        collectAreaReachability(controller.signal),
        nextContext.available ? loadAreaPulseSnapshot(controller.signal) : Promise.resolve(null),
      ]);
      setReachability(checks);
      setSnapshot(nextSnapshot);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Area Pulse is unavailable.");
    } finally {
      if (requestRef.current === controller) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void refresh(); });
    return () => {
      active = false;
      requestRef.current?.abort();
    };
  }, [refresh]);

  const deleteReport = async (report: SavedAreaReport) => {
    try {
      await deleteAreaPulseReport(report);
      setSavedReports(loadSavedAreaReports());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The report could not be deleted.");
    }
  };

  const outcome = snapshot ? outcomeCopy(snapshot.outcome) : null;
  const browserOnline = typeof navigator !== "undefined" && navigator.onLine;

  return (
    <div className="area-pulse-page">
      <section className="area-pulse-hero" aria-labelledby="area-pulse-title">
        <div>
          <Badge variant="outline"><RadioTower aria-hidden="true" /> Regional evidence</Badge>
          <h2 id="area-pulse-title">Is it just me?</h2>
          <p>Area Pulse combines privacy-thresholded NetPulse reports, coarse regional baselines, controlled browser checks, and explicitly sourced provider notices. It never calls one failed request an outage.</p>
        </div>
        <div className="area-pulse-hero__actions">
          <Button variant="outline" onClick={() => void refresh()} disabled={loading}><RefreshCw aria-hidden="true" /> {loading ? "Checking…" : "Refresh evidence"}</Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild><Button disabled={!context?.reportingAvailable}><AlertTriangle aria-hidden="true" /> Report a problem</Button></DialogTrigger>
            {context?.turnstileSiteKey && <AreaReportDialog context={context} result={result} onAccepted={() => { setDialogOpen(false); setSavedReports(loadSavedAreaReports()); void refresh(); }} />}
          </Dialog>
        </div>
      </section>

      {(error || context?.reason) && <div className="area-pulse-notice" role="status"><AlertTriangle aria-hidden="true" /><div><strong>{error ? "Regional service unavailable" : "Reporting is not available"}</strong><p>{error ?? context?.reason}</p><p>No regional conclusion or substitute data has been generated.</p></div></div>}
      {notice && <div className="area-pulse-notice area-pulse-notice--success" role="status"><CheckCircle2 aria-hidden="true" /><div><strong>Private flag accepted</strong><p>{notice}</p></div></div>}

      <section className="area-status-grid" aria-label="Current evidence">
        <StatusCard title="Your connection" value={browserOnline ? "Browser reports online" : "Browser reports offline"} detail={result ? `Latest measured confidence ${result.confidence.score}/100 at ${new Date(result.timestamp).toLocaleString()}.` : "Run a NetPulse speed test for measured local evidence."} tone={browserOnline ? "healthy" : "critical"} />
        <StatusCard title="Approximate region" value={context?.region?.label ?? "Unavailable"} detail={context?.locationNotice ?? "No location has been returned."} tone={context?.region ? "neutral" : "warning"} />
        <StatusCard title="Regional assessment" value={outcome?.title ?? "Insufficient evidence"} detail={outcome?.detail ?? "Regional aggregation has not returned a result."} tone={snapshot?.incidents.length ? "warning" : "neutral"} />
        <StatusCard title="Local vs ISP" value={localAssessment(result)} detail="A browser test cannot inspect your router, Wi-Fi radio, or ISP plant. This is evidence guidance, not causal proof." tone="neutral" />
      </section>

      <div className="area-pulse-columns">
        <Card>
          <CardHeader><CardTitle>Independent service reachability</CardTitle><CardDescription>Real timed HTTPS transactions from this browser. These are separate checks, but the current external destinations are not treated as independently operated corroboration.</CardDescription></CardHeader>
          <CardContent className="reachability-list">
            {reachability.length === 0 ? <p className="empty-copy">{loading ? "Checks in progress…" : "Measurement unavailable in this browser."}</p> : reachability.map((check) => (
              <div key={check.label}><span className={`evidence-dot evidence-dot--${check.status}`} aria-hidden="true" /><div><strong>{check.label}</strong><p>{check.provider} · {check.durationMs === null ? "duration unavailable" : `${Math.round(check.durationMs)} ms`}</p><small>{check.limitation}</small></div><Badge variant="outline">{check.status}</Badge></div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Evidence rules</CardTitle><CardDescription>Public crowd activity is deliberately conservative.</CardDescription></CardHeader>
          <CardContent className="evidence-rules">
            <div><strong>{context?.minimumReports ?? 3}</strong><span>distinct reporter keys before a crowd cluster can appear</span></div>
            <div><strong>30 min</strong><span>matching provider, region, and failure-pattern window</span></div>
            <div><strong>{context?.retentionDays ?? 30} days</strong><span>maximum report-row retention; public visibility expires sooner</span></div>
            <p><ShieldCheck aria-hidden="true" /> Raw addresses and exact coordinates are not stored in the Area Pulse tables. “Official” is reserved for signed, configured provider sources.</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Regional incident list</CardTitle><CardDescription>Accessible list view; no heatmap is rendered when evidence is sparse or unavailable.</CardDescription></CardHeader>
        <CardContent className="incident-list">
          {!snapshot ? <p className="empty-copy">{loading ? "Loading privacy-thresholded regional evidence…" : "Regional evidence is unavailable."}</p> : snapshot.incidents.length === 0 ? <HonestEmptyState snapshot={snapshot} /> : snapshot.incidents.map((incident) => (
            <article key={incident.id} className="area-incident">
              <div className="area-incident__head"><div><Badge variant="outline">{confidenceLabel(incident.confidence)}</Badge><h3>{incident.isp}</h3><p>{incident.asn ?? "ASN unavailable"} · {incident.region.label} (approximate)</p></div><strong className="area-incident__score">{incident.confidenceScore}<span>/100</span></strong></div>
              <dl><div><dt>Pattern</dt><dd>{incident.affectedServices.join(", ")}</dd></div><div><dt>Reports</dt><dd>{incident.distinctReporters} distinct / {incident.reportCount} total</dd></div><div><dt>First observed</dt><dd>{new Date(incident.startedAt).toLocaleString()}</dd></div><div><dt>Expires</dt><dd>{new Date(incident.expiresAt).toLocaleString()}</dd></div></dl>
              <ul>{incident.confidenceReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
              <div className="incident-sources">{incident.sources.map((source) => source.url ? <a key={`${source.kind}-${source.observedAt}`} href={source.url} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" /> {source.label}</a> : <span key={`${source.kind}-${source.observedAt}`}>{source.label}</span>)}</div>
              {context?.reportingAvailable && <Button variant="ghost" size="sm" className="incident-flag" onClick={() => setFlaggedIncident(incident.id)}><Flag aria-hidden="true" /> Report inaccurate or unsafe aggregate</Button>}
            </article>
          ))}
        </CardContent>
        {snapshot && <CardFooter className="area-limitations"><ul>{snapshot.limitations.map((item) => <li key={item}>{item}</li>)}</ul></CardFooter>}
      </Card>

      {savedReports.length > 0 && <Card>
        <CardHeader><CardTitle>Your report deletion receipts</CardTitle><CardDescription>Stored only in this browser. NetPulse cannot recover a lost deletion token.</CardDescription></CardHeader>
        <CardContent className="saved-report-list">{savedReports.map((report) => <div key={report.id}><div><strong>{report.kind.replaceAll("_", " ")}</strong><p>{report.regionLabel} · {new Date(report.createdAt).toLocaleString()}</p></div><Button variant="outline" size="sm" onClick={() => void deleteReport(report)}><Trash2 aria-hidden="true" /> Delete report</Button></div>)}</CardContent>
      </Card>}
      <Dialog open={flaggedIncident !== null} onOpenChange={(open) => { if (!open) setFlaggedIncident(null); }}>
        {flaggedIncident && context?.turnstileSiteKey && <AbuseReportDialog incidentId={flaggedIncident} siteKey={context.turnstileSiteKey} onAccepted={() => { setFlaggedIncident(null); setNotice("Thank you. The aggregate was flagged for operator review without publishing your details."); }} />}
      </Dialog>
    </div>
  );
}

function AreaReportDialog({ context, result, onAccepted }: { context: AreaPulseContext; result: TestResult | null; onAccepted: () => void }) {
  const [kind, setKind] = useState<AreaReportKind>("complete_outage");
  const [isp, setIsp] = useState("");
  const [asn, setAsn] = useState("");
  const [service, setService] = useState("");
  const [note, setNote] = useState("");
  const [consent, setConsent] = useState(false);
  const [attachMeasurement, setAttachMeasurement] = useState(Boolean(result));
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const onToken = useCallback((next: string) => setToken(next), []);
  const measurement = useMemo<AreaPulseReportInput["measurement"]>(() => result && attachMeasurement ? { confidence: result.confidence.score, downloadMbps: result.downloadMbps, uploadMbps: result.uploadMbps, idleLatencyMs: result.idlePingMs, dnsFailed: null, primaryReachable: true } : null, [attachMeasurement, result]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setStatus(null);
    try {
      await submitAreaPulseReport({ kind, isp, asn: asn.trim() || null, service: kind === "service_unavailable" ? service : null, note: note.trim() || null, turnstileToken: token, identityConsent: consent, measurement });
      onAccepted();
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "The report could not be submitted.");
    } finally {
      setSubmitting(false);
    }
  };

  return <DialogContent className="area-report-dialog">
    <DialogHeader><DialogTitle>Report a connection problem</DialogTitle><DialogDescription>One report never declares an outage. ISP/ASN are user confirmed; region is coarse and IP-derived. Notes never appear publicly.</DialogDescription></DialogHeader>
    <form id="area-report-form" className="area-report-form" onSubmit={(event) => void submit(event)}>
      <Field label="Problem type"><Select value={kind} onValueChange={(value) => setKind(value as AreaReportKind)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{REPORT_KINDS.map((item) => <SelectItem key={item} value={item}>{areaReportLabel(item)}</SelectItem>)}</SelectContent></Select></Field>
      <div className="area-report-grid"><Field label="ISP (user confirmed)"><Input value={isp} onChange={(event) => setIsp(event.target.value)} minLength={2} maxLength={80} required autoComplete="organization" /></Field><Field label="ASN (optional)"><Input value={asn} onChange={(event) => setAsn(event.target.value)} maxLength={12} placeholder="AS64500" /></Field></div>
      {kind === "service_unavailable" && <Field label="Unavailable service"><Input value={service} onChange={(event) => setService(event.target.value)} minLength={2} maxLength={80} required /></Field>}
      <Field label="Optional private note"><Textarea value={note} onChange={(event) => setNote(event.target.value)} minLength={2} maxLength={240} placeholder="No links, contact details, or personal information." /><small>{note.length}/240 · stored for abuse/operations review, never included in public aggregates</small></Field>
      <label className="consent-row"><Checkbox checked={attachMeasurement} disabled={!result} onCheckedChange={(checked) => setAttachMeasurement(checked === true)} /><span>Attach the latest limited measurement summary {result ? `(confidence ${result.confidence.score}/100)` : "(no test available)"}</span></label>
      <label className="consent-row"><Checkbox checked={consent} onCheckedChange={(checked) => setConsent(checked === true)} required /><span>I consent to grouping this report by user-confirmed ISP/ASN and approximate {context.region?.level ?? "region"}. Exact coordinates are not used.</span></label>
      <TurnstileWidget siteKey={context.turnstileSiteKey ?? ""} onToken={onToken} />
      {status && <p className="form-error" role="alert">{status}</p>}
    </form>
    <DialogFooter><Button type="submit" form="area-report-form" disabled={!token || !consent || submitting}>{submitting ? "Submitting…" : "Submit anonymous report"}</Button></DialogFooter>
  </DialogContent>;
}

function AbuseReportDialog({ incidentId, siteKey, onAccepted }: { incidentId: string; siteKey: string; onAccepted: () => void }) {
  const [reason, setReason] = useState<"inaccurate" | "personal_data" | "spam" | "other">("inaccurate");
  const [details, setDetails] = useState("");
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const onToken = useCallback((next: string) => setToken(next), []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setStatus(null);
    try {
      await submitAreaPulseAbuseReport({ incidentId, reason, details: details.trim() || null, turnstileToken: token });
      onAccepted();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The abuse report could not be submitted.");
    } finally {
      setSubmitting(false);
    }
  };
  return <DialogContent>
    <DialogHeader><DialogTitle>Flag this aggregate</DialogTitle><DialogDescription>This private report helps operators review inaccurate, unsafe, or abusive aggregate data. Do not include personal information, links, or contact details.</DialogDescription></DialogHeader>
    <form id="area-abuse-form" className="area-report-form" onSubmit={(event) => void submit(event)}>
      <Field label="Reason"><Select value={reason} onValueChange={(value) => setReason(value as typeof reason)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="inaccurate">Inaccurate aggregate</SelectItem><SelectItem value="personal_data">Possible personal data</SelectItem><SelectItem value="spam">Spam or manipulation</SelectItem><SelectItem value="other">Other safety issue</SelectItem></SelectContent></Select></Field>
      <Field label="Optional details"><Textarea value={details} onChange={(event) => setDetails(event.target.value)} maxLength={500} /><small>{details.length}/500</small></Field>
      <TurnstileWidget siteKey={siteKey} action="area-pulse-abuse" onToken={onToken} />
      {status && <p className="form-error" role="alert">{status}</p>}
    </form>
    <DialogFooter><Button type="submit" form="area-abuse-form" disabled={!token || submitting}>{submitting ? "Submitting…" : "Submit private flag"}</Button></DialogFooter>
  </DialogContent>;
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="field-stack"><span>{label}</span>{children}</label>; }

function StatusCard({ title, value, detail, tone }: { title: string; value: string; detail: string; tone: "healthy" | "warning" | "critical" | "neutral" }) {
  const Icon = tone === "healthy" ? CheckCircle2 : tone === "critical" ? WifiOff : tone === "warning" ? AlertTriangle : MapPin;
  return <Card className={`area-status area-status--${tone}`}><CardContent><Icon aria-hidden="true" /><div><span>{title}</span><strong>{value}</strong><p>{detail}</p></div></CardContent></Card>;
}

function HonestEmptyState({ snapshot }: { snapshot: AreaPulseSnapshot }) {
  return <div className="area-empty"><Globe2 aria-hidden="true" /><div><strong>{snapshot.outcome === "no-regional-incident" ? "No regional incident detected" : "Insufficient NetPulse data"}</strong><p>{snapshot.outcome === "no-regional-incident" ? "No privacy-thresholded incident cluster is active against the mature regional baseline." : "There are not enough privacy-thresholded reports and historical windows for a regional conclusion."}</p><p>This does not prove that your ISP or a destination has no issue.</p></div></div>;
}

function localAssessment(result: TestResult | null): string {
  if (!result) return "No local measurement yet";
  if (result.confidence.score < 65) return "Latest test confidence is low";
  if (result.downloadMbps <= 0 || result.uploadMbps <= 0) return "Connection measurement incomplete";
  if (result.bufferbloatGrade === "D" || result.bufferbloatGrade === "F") return "Measured degradation under load";
  return "Latest browser test completed";
}

function outcomeCopy(outcome: AreaPulseSnapshot["outcome"]): { title: string; detail: string } {
  const copy: Record<AreaPulseSnapshot["outcome"], { title: string; detail: string }> = {
    "possible-device-problem": { title: "Your device may be the issue", detail: "Regional evidence does not explain this device-specific symptom." },
    "possible-local-network-problem": { title: "Your local network may be the issue", detail: "Check Wi-Fi/router conditions before attributing the symptom to a regional ISP outage." },
    "isp-connection-degraded": { title: "Your ISP connection may be degraded", detail: "Measured evidence suggests degradation but does not establish a regional outage." },
    "possible-regional-disruption": { title: "Possible regional ISP disruption", detail: "A privacy-thresholded incident cluster is active; inspect confidence and sources." },
    "destination-specific-problem": { title: "Specific service may be unavailable", detail: "Reports cluster around a named destination rather than general internet access." },
    "general-internet-incident": { title: "Possible general internet incident", detail: "Multiple independent sources would be required for this conclusion." },
    "no-regional-incident": { title: "No regional incident detected", detail: "No qualifying cluster is active against available evidence." },
    "insufficient-evidence": { title: "Insufficient NetPulse data", detail: "The crowd threshold or historical baseline is not mature enough." },
  };
  return copy[outcome];
}

function confidenceLabel(value: string): string { return value === "official" ? "Official provider confirmation" : value === "likely" ? "Likely" : value === "possible" ? "Possible" : "Insufficient data"; }
