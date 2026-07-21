import {
  Activity,
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Download,
  EthernetPort,
  FileDown,
  FlaskConical,
  Gauge,
  Info,
  Laptop,
  ListChecks,
  Play,
  RefreshCcw,
  Router,
  ShieldAlert,
  Signal,
  Sparkles,
  Trash2,
  TriangleAlert,
  Wifi,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { runTest, type Phase, type TestResult } from "../lib/engine";
import {
  DEFAULT_CONDITIONS,
  SYMPTOMS,
  createDiagnosticSession,
  evaluateDiagnostic,
  snapshotDiagnosticRun,
  type AssessmentState,
  type CauseAssessment,
  type DiagnosticConditions,
  type DiagnosticRunKind,
  type DiagnosticSession,
  type DiagnosticSymptom,
} from "../lib/diagnostics";
import { COMPARISONS, GUIDES, recommendedComparisons, type DiagnosticComparison } from "../lib/diagnosticKnowledge";
import { downloadPrivacySafeDiagnosticReport } from "../lib/diagnosticReport";
import { deleteDiagnosticSession, loadDiagnosticSessions, saveDiagnosticSession } from "../lib/diagnosticSessions";
import { ArcProgress, ArcTimeline, ArcTimelineItem } from "./ArcTelemetry";
import { NetPulseFooter } from "./SpeedTestSections";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Separator } from "./ui/separator";
import { Switch } from "./ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

const PHASE_DETAILS: Record<Phase, { label: string; progress: number }> = {
  idle: { label: "Ready to measure", progress: 0 },
  preflight: { label: "Checking browser and connection", progress: 8 },
  server: { label: "Selecting the measurement endpoint", progress: 18 },
  latency: { label: "Measuring idle latency", progress: 30 },
  download_single: { label: "Measuring single-stream download", progress: 44 },
  download_multi: { label: "Measuring multi-stream download and loaded latency", progress: 60 },
  upload: { label: "Measuring upload and loaded latency", progress: 78 },
  packetloss: { label: "Checking experimental UDP reachability", progress: 92 },
  done: { label: "Measurement complete", progress: 100 },
  error: { label: "Measurement stopped", progress: 0 },
};

const SYMPTOM_ICONS: Record<DiagnosticSymptom, LucideIcon> = {
  "buffering-video": Play,
  "video-calls": Signal,
  gaming: Activity,
  "slow-downloads": Download,
  "slow-uploads": Gauge,
  "slow-websites": Clock3,
  intermittent: RefreshCcw,
  offline: XCircle,
  other: CircleAlert,
};

export function FixMyInternet({
  lowData,
  onMeasured,
}: {
  lowData: boolean;
  onMeasured: (result: TestResult) => void;
}) {
  const [sessions, setSessions] = useState<DiagnosticSession[]>(loadDiagnosticSessions);
  const [session, setSession] = useState<DiagnosticSession | null>(() => loadDiagnosticSessions()[0] ?? null);
  const [conditions, setConditions] = useState<DiagnosticConditions>(() => sessionBaselineConditions(loadDiagnosticSessions()[0]));
  const [comparison, setComparison] = useState<DiagnosticComparison | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [running, setRunning] = useState(false);
  const [dataUsedMB, setDataUsedMB] = useState(0);
  const [liveMbps, setLiveMbps] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const evaluation = useMemo(() => (session ? evaluateDiagnostic(session) : null), [session]);
  const recommended = session ? recommendedComparisons(session.symptom) : [];
  const currentKind: DiagnosticRunKind = session?.runs.length ? comparison?.kind ?? "original-room" : "baseline";
  const canRun = Boolean(session) && !running && (currentKind === "baseline" || Boolean(comparison?.available && confirmed));

  const begin = (symptom: DiagnosticSymptom) => {
    const next = createDiagnosticSession(symptom);
    setSession(next);
    setConditions(DEFAULT_CONDITIONS);
    setComparison(null);
    setConfirmed(false);
    setMessage("New local diagnostic session created. Describe the baseline conditions before measuring.");
  };

  const updateSession = (updater: (current: DiagnosticSession) => DiagnosticSession) => {
    setSession((current) => {
      if (!current) return current;
      const next = updater(current);
      setSessions(saveDiagnosticSession(next));
      return next;
    });
  };

  const selectComparison = (item: DiagnosticComparison) => {
    setComparison(item);
    const baseline = session?.runs.find((run) => run.kind === "baseline");
    setConditions({ ...(baseline?.conditions ?? DEFAULT_CONDITIONS), ...item.changes });
    setConfirmed(false);
    setMessage(item.available ? null : item.limitation ?? "Measurement unavailable in this browser.");
  };

  const executeRun = async () => {
    if (!session || !canRun) return;
    setRunning(true);
    setPhase("preflight");
    setDataUsedMB(0);
    setLiveMbps(null);
    setMessage(null);
    const label = currentKind === "baseline" ? "Baseline" : comparison?.shortLabel ?? "Comparison";
    try {
      const result = await runTest(
        { lowData },
        {
          onPhase: setPhase,
          onBytes: (bytes) => setDataUsedMB(bytes / 1_000_000),
          onSample: (sample) => {
            if (sample.mbps !== undefined) setLiveMbps(sample.mbps);
          },
        },
      );
      const run = snapshotDiagnosticRun(result, currentKind, label, conditions);
      const next = { ...session, updatedAt: Date.now(), runs: [...session.runs, run] };
      setSession(next);
      setSessions(saveDiagnosticSession(next));
      onMeasured(result);
      setPhase("done");
      setMessage(buildCompletionMessage(run.kind, run.measurement.observedIpFamily, run.conditions.requestedIpFamily));
      setComparison(null);
      setConfirmed(false);
    } catch (error) {
      console.error("NetPulse diagnostic measurement failed.", error);
      setPhase("error");
      setMessage(error instanceof Error ? `Measurement failed: ${error.message}` : "Measurement failed unexpectedly. No diagnostic run was saved.");
    } finally {
      setRunning(false);
    }
  };

  const openSession = (selected: DiagnosticSession) => {
    setSession(selected);
    setConditions(sessionBaselineConditions(selected));
    setComparison(null);
    setConfirmed(false);
    setMessage("Opened the locally saved diagnostic session.");
  };

  const removeSession = (id: string) => {
    const next = deleteDiagnosticSession(id);
    setSessions(next);
    const replacement = next[0] ?? null;
    setSession(replacement);
    setConditions(sessionBaselineConditions(replacement));
    setComparison(null);
  };

  return (
    <div className="view-stack diagnostic-page">
      <section className="diagnostic-hero" aria-labelledby="diagnostic-title">
        <div>
          <span className="section-kicker">Evidence before advice</span>
          <h2 id="diagnostic-title">Fix My Internet</h2>
          <p>
            Run controlled comparisons, keep every real measurement in one local session, and separate what NetPulse observed from what still needs proof.
          </p>
        </div>
        <div className="diagnostic-hero__trust">
          <ShieldAlert aria-hidden="true" />
          <span><strong>No invented diagnoses.</strong> Browser-only limits stay visible, and reports exclude full IPs, SSIDs, and device names.</span>
        </div>
      </section>

      {!session ? (
        <SymptomPicker onSelect={begin} />
      ) : (
        <>
          <SessionHeader session={session} onNew={() => setSession(null)} onReport={() => downloadPrivacySafeDiagnosticReport(session)} />
          <WorkflowStrip session={session} running={running} />

          <Tabs defaultValue={session.runs.length === 0 ? "measure" : "evidence"} className="diagnostic-tabs">
            <TabsList variant="line" aria-label="Diagnostic workflow sections">
              <TabsTrigger value="measure">Measure</TabsTrigger>
              <TabsTrigger value="evidence" disabled={session.runs.length === 0}>Evidence</TabsTrigger>
              <TabsTrigger value="plan" disabled={session.runs.length === 0}>Fix plan</TabsTrigger>
              <TabsTrigger value="guides">Guides</TabsTrigger>
            </TabsList>

            <TabsContent value="measure" className="diagnostic-tab-content">
              {session.runs.length === 0 ? (
                <BaselineSetup
                  session={session}
                  conditions={conditions}
                  onConditions={setConditions}
                  onPlan={(download, upload) => updateSession((current) => ({ ...current, planDownloadMbps: download, planUploadMbps: upload }))}
                />
              ) : (
                <ComparisonPicker selected={comparison} recommended={recommended} onSelect={selectComparison} />
              )}

              {comparison && <ComparisonInstructions comparison={comparison} />}
              {(session.runs.length === 0 || comparison?.available) && (
                <RunPanel
                  kind={currentKind}
                  comparison={comparison}
                  conditions={conditions}
                  onConditions={setConditions}
                  confirmed={confirmed}
                  onConfirmed={setConfirmed}
                  phase={phase}
                  running={running}
                  dataUsedMB={dataUsedMB}
                  liveMbps={liveMbps}
                  lowData={lowData}
                  canRun={canRun}
                  onRun={() => void executeRun()}
                  message={message}
                />
              )}
              {comparison && !comparison.available && <UnavailableComparison comparison={comparison} />}
              {session.runs.length > 0 && <RunTimeline session={session} />}
            </TabsContent>

            <TabsContent value="evidence" className="diagnostic-tab-content">
              {evaluation && <EvidenceView evaluation={evaluation} />}
            </TabsContent>

            <TabsContent value="plan" className="diagnostic-tab-content">
              {evaluation && <FixPlan evaluation={evaluation} onReport={() => downloadPrivacySafeDiagnosticReport(session)} />}
            </TabsContent>

            <TabsContent value="guides" className="diagnostic-tab-content">
              <GuideLibrary />
            </TabsContent>
          </Tabs>
        </>
      )}

      {sessions.length > 0 && <SavedSessions sessions={sessions} activeId={session?.id ?? null} onOpen={openSession} onDelete={removeSession} />}
      <NetPulseFooter />
    </div>
  );
}

function SymptomPicker({ onSelect }: { onSelect: (symptom: DiagnosticSymptom) => void }) {
  return (
    <Card className="page-card">
      <CardHeader>
        <span className="section-kicker">Step 1</span>
        <CardTitle>What are you experiencing?</CardTitle>
        <CardDescription>The symptom chooses the most useful comparisons; it never predetermines the diagnosis.</CardDescription>
      </CardHeader>
      <CardContent className="symptom-grid">
        {SYMPTOMS.map((symptom) => {
          const Icon = SYMPTOM_ICONS[symptom.id];
          return (
            <button key={symptom.id} className="symptom-card" onClick={() => onSelect(symptom.id)}>
              <Icon aria-hidden="true" />
              <span><strong>{symptom.label}</strong><small>{symptom.description}</small></span>
              <ArrowRight aria-hidden="true" />
            </button>
          );
        })}
      </CardContent>
    </Card>
  );
}

function SessionHeader({ session, onNew, onReport }: { session: DiagnosticSession; onNew: () => void; onReport: () => void }) {
  const symptom = SYMPTOMS.find((item) => item.id === session.symptom);
  return (
    <Card className="page-card session-header-card">
      <CardContent className="session-header">
        <div>
          <span className="section-kicker">Current session</span>
          <h3>{symptom?.label ?? "Diagnostic session"}</h3>
          <p>{session.runs.length} measured run{session.runs.length === 1 ? "" : "s"} · saved only in this browser</p>
        </div>
        <div className="session-header__actions">
          {session.runs.length > 0 && <Button variant="outline" onClick={onReport}><FileDown aria-hidden="true" /> Privacy-safe report</Button>}
          <Button variant="secondary" onClick={onNew}><Sparkles aria-hidden="true" /> New session</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function WorkflowStrip({ session, running }: { session: DiagnosticSession; running: boolean }) {
  const steps = [
    { label: "Symptom", done: true },
    { label: "Baseline", done: session.runs.some((run) => run.kind === "baseline") },
    { label: "Compare", done: session.runs.length >= 2 },
    { label: "Act & retest", done: session.runs.length >= 3 },
  ];
  return (
    <ol className="workflow-strip" aria-label="Diagnostic progress">
      {steps.map((step, index) => (
        <li key={step.label} data-complete={step.done || undefined} data-active={!step.done && steps.slice(0, index).every((item) => item.done) || undefined}>
          <span>{step.done ? <CheckCircle2 aria-hidden="true" /> : index + 1}</span>
          <strong>{step.label}</strong>
          {running && !step.done && <small>In progress</small>}
        </li>
      ))}
    </ol>
  );
}

function BaselineSetup({
  session,
  conditions,
  onConditions,
  onPlan,
}: {
  session: DiagnosticSession;
  conditions: DiagnosticConditions;
  onConditions: (conditions: DiagnosticConditions) => void;
  onPlan: (download: number | null, upload: number | null) => void;
}) {
  return (
    <Card className="page-card">
      <CardHeader>
        <span className="section-kicker">Step 2 · Baseline</span>
        <CardTitle>Record the problem condition</CardTitle>
        <CardDescription>These labels are user-confirmed context. NetPulse will measure performance, but cannot inspect the router or reliably detect the link or VPN.</CardDescription>
      </CardHeader>
      <CardContent className="baseline-layout">
        <ConditionEditor conditions={conditions} onChange={onConditions} />
        <div className="plan-reference">
          <div><strong>Optional plan reference</strong><small>Used only to decide whether repeated Ethernet tests warrant provider investigation. It is not treated as measured speed.</small></div>
          <label htmlFor="plan-download">Advertised download (Mbps)</label>
          <Input id="plan-download" type="number" min="1" inputMode="decimal" defaultValue={session.planDownloadMbps ?? ""} onBlur={(event) => onPlan(toPositiveNumber(event.target.value), session.planUploadMbps)} />
          <label htmlFor="plan-upload">Advertised upload (Mbps)</label>
          <Input id="plan-upload" type="number" min="1" inputMode="decimal" defaultValue={session.planUploadMbps ?? ""} onBlur={(event) => onPlan(session.planDownloadMbps, toPositiveNumber(event.target.value))} />
        </div>
      </CardContent>
    </Card>
  );
}

function ComparisonPicker({
  selected,
  recommended,
  onSelect,
}: {
  selected: DiagnosticComparison | null;
  recommended: DiagnosticRunKind[];
  onSelect: (comparison: DiagnosticComparison) => void;
}) {
  const ordered = [...COMPARISONS].sort((a, b) => Number(recommended.includes(b.kind)) - Number(recommended.includes(a.kind)));
  return (
    <Card className="page-card">
      <CardHeader>
        <span className="section-kicker">Controlled comparisons</span>
        <CardTitle>Change one condition</CardTitle>
        <CardDescription>Recommended tests appear first. A comparison only supports a cause when the run quality and conditions are compatible.</CardDescription>
      </CardHeader>
      <CardContent className="comparison-grid">
        {ordered.map((item) => (
          <button
            key={item.kind}
            className="comparison-card"
            data-selected={selected?.kind === item.kind || undefined}
            data-unavailable={!item.available || undefined}
            onClick={() => onSelect(item)}
          >
            <span className="comparison-card__icon">{comparisonIcon(item.kind)}</span>
            <span><strong>{item.title}</strong><small>{item.why}</small></span>
            <span className="comparison-card__badges">
              {recommended.includes(item.kind) && <Badge>Recommended</Badge>}
              {!item.available && <Badge variant="outline">Unavailable</Badge>}
            </span>
          </button>
        ))}
      </CardContent>
    </Card>
  );
}

function ComparisonInstructions({ comparison }: { comparison: DiagnosticComparison }) {
  return (
    <Card className="page-card comparison-instructions">
      <CardHeader><CardTitle>{comparison.title}</CardTitle><CardDescription>{comparison.why}</CardDescription></CardHeader>
      <CardContent>
        <ol>{comparison.instructions.map((instruction) => <li key={instruction}>{instruction}</li>)}</ol>
        {comparison.limitation && <p className="measurement-limitation"><TriangleAlert aria-hidden="true" /> {comparison.limitation}</p>}
      </CardContent>
    </Card>
  );
}

function RunPanel({
  kind,
  comparison,
  conditions,
  onConditions,
  confirmed,
  onConfirmed,
  phase,
  running,
  dataUsedMB,
  liveMbps,
  lowData,
  canRun,
  onRun,
  message,
}: {
  kind: DiagnosticRunKind;
  comparison: DiagnosticComparison | null;
  conditions: DiagnosticConditions;
  onConditions: (conditions: DiagnosticConditions) => void;
  confirmed: boolean;
  onConfirmed: (confirmed: boolean) => void;
  phase: Phase;
  running: boolean;
  dataUsedMB: number;
  liveMbps: number | null;
  lowData: boolean;
  canRun: boolean;
  onRun: () => void;
  message: string | null;
}) {
  const phaseDetail = PHASE_DETAILS[phase];
  const baseline = kind === "baseline";
  return (
    <Card className="page-card run-panel">
      <CardHeader>
        <span className="section-kicker">{baseline ? "Real baseline measurement" : "Real comparison measurement"}</span>
        <CardTitle>{baseline ? "Measure this condition" : comparison?.shortLabel}</CardTitle>
        <CardDescription>Uses the same measured NetPulse pipeline as Speed Test. Stage progress is discrete pipeline state, not simulated completion time.</CardDescription>
      </CardHeader>
      <CardContent className="run-panel__content">
        <ConditionEditor conditions={conditions} onChange={onConditions} compact />
        {!baseline && (
          <label className="confirmation-row">
            <span><strong>I set the comparison conditions</strong><small>The browser cannot verify physical location, Ethernet use, VPN state, other devices, or paused household traffic.</small></span>
            <Switch checked={confirmed} onCheckedChange={onConfirmed} aria-label="Confirm comparison conditions are set" />
          </label>
        )}
        {(running || phase === "done" || phase === "error") && (
          <div className="measurement-progress" role="status" aria-live="polite">
            <ArcProgress value={phaseDetail.progress} label={phaseDetail.label} aria-label={`${phaseDetail.label}: ${phaseDetail.progress}% of pipeline stages entered`} />
            <div><strong>{phaseDetail.label}</strong><span>{liveMbps === null ? "Waiting for a throughput sample" : `${formatSpeed(liveMbps)} Mbps live`} · {dataUsedMB.toFixed(1)} MB transferred</span></div>
          </div>
        )}
        {message && <p className={phase === "error" ? "run-message run-message--error" : "run-message"}>{message}</p>}
      </CardContent>
      <CardFooter className="run-panel__footer">
        <div><strong>{lowData ? "Low-data profile" : "Full profile"}</strong><small>Configured in Settings. The completed run records actual duration, samples, bytes, endpoint, and confidence.</small></div>
        <Button size="lg" disabled={!canRun} onClick={onRun}><Play aria-hidden="true" /> {running ? "Measuring…" : baseline ? "Run baseline" : "Run comparison"}</Button>
      </CardFooter>
    </Card>
  );
}

function ConditionEditor({ conditions, onChange, compact = false }: { conditions: DiagnosticConditions; onChange: (conditions: DiagnosticConditions) => void; compact?: boolean }) {
  const set = <K extends keyof DiagnosticConditions>(key: K, value: DiagnosticConditions[K]) => onChange({ ...conditions, [key]: value });
  return (
    <div className={compact ? "condition-grid condition-grid--compact" : "condition-grid"}>
      <ConditionSelect label="Connection" value={conditions.link} options={["wifi", "ethernet", "unknown"]} onValue={(value) => set("link", value as DiagnosticConditions["link"])} />
      <ConditionSelect label="Location" value={conditions.location} options={["usual", "near-router", "unknown"]} onValue={(value) => set("location", value as DiagnosticConditions["location"])} />
      <ConditionSelect label="VPN" value={conditions.vpn} options={["on", "off", "unknown"]} onValue={(value) => set("vpn", value as DiagnosticConditions["vpn"])} />
      <ConditionSelect label="Other traffic" value={conditions.backgroundTraffic} options={["normal", "paused", "unknown"]} onValue={(value) => set("backgroundTraffic", value as DiagnosticConditions["backgroundTraffic"])} />
      <ConditionSelect label="Device" value={conditions.device} options={["primary", "other"]} onValue={(value) => set("device", value as DiagnosticConditions["device"])} />
      <ConditionSelect label="Time" value={conditions.time} options={["usual", "peak", "off-peak"]} onValue={(value) => set("time", value as DiagnosticConditions["time"])} />
    </div>
  );
}

function ConditionSelect({ label, value, options, onValue }: { label: string; value: string; options: string[]; onValue: (value: string) => void }) {
  return (
    <label className="condition-field"><span>{label}</span><Select value={value} onValueChange={onValue}><SelectTrigger aria-label={label}><SelectValue /></SelectTrigger><SelectContent>{options.map((option) => <SelectItem key={option} value={option}>{humanize(option)}</SelectItem>)}</SelectContent></Select></label>
  );
}

function UnavailableComparison({ comparison }: { comparison: DiagnosticComparison }) {
  return (
    <Card className="page-card unavailable-card">
      <CardContent><FlaskConical aria-hidden="true" /><div><strong>Measurement unavailable in this browser</strong><p>{comparison.limitation}</p><p>No substitute value, simulated run, or diagnosis will be generated.</p></div></CardContent>
    </Card>
  );
}

function RunTimeline({ session }: { session: DiagnosticSession }) {
  return (
    <Card className="page-card">
      <CardHeader><CardTitle>Session evidence</CardTitle><CardDescription>Every entry below came from a completed NetPulse measurement.</CardDescription></CardHeader>
      <CardContent>
        <ArcTimeline className="diagnostic-timeline">
          {session.runs.map((run) => (
            <ArcTimelineItem key={run.id} heading={run.label} date={new Date(run.measuredAt).toLocaleString()}>
              <div className="timeline-metrics">
                <span><strong>{formatSpeed(run.measurement.downloadMbps)}</strong> Mbps down</span>
                <span><strong>{formatSpeed(run.measurement.uploadMbps)}</strong> Mbps up</span>
                <span><strong>{Math.round(run.measurement.idleLatencyMs)}</strong> ms idle</span>
                <span><strong>{Math.round(run.measurement.confidenceScore)}%</strong> confidence</span>
              </div>
              <dl className="run-metadata">
                <div><dt>Loaded latency</dt><dd>{Math.round(run.measurement.loadedDownMs)} ms down / {Math.round(run.measurement.loadedUpMs)} ms up</dd></div>
                <div><dt>Jitter / stability</dt><dd>{Math.round(run.measurement.jitterMs)} ms / {Math.round(run.measurement.stabilityScore)}/100</dd></div>
                <div><dt>Samples</dt><dd>{run.measurement.idleSamples} idle / {run.measurement.loadedDownSamples} down-loaded / {run.measurement.loadedUpSamples} up-loaded</dd></div>
                <div><dt>Test profile</dt><dd>{(run.measurement.durationMs / 1000).toFixed(1)} s / {run.measurement.dataUsedMB.toFixed(1)} MB transferred</dd></div>
                <div><dt>Endpoint</dt><dd>{run.measurement.endpointProvider} {run.measurement.endpointEdge ?? "edge unavailable"} · {run.measurement.endpointProtocol} · observed {run.measurement.observedIpFamily}</dd></div>
              </dl>
            </ArcTimelineItem>
          ))}
        </ArcTimeline>
      </CardContent>
    </Card>
  );
}

function EvidenceView({ evaluation }: { evaluation: ReturnType<typeof evaluateDiagnostic> }) {
  return (
    <div className="section-stack">
      <Card className="page-card evidence-summary-card">
        <CardHeader><span className="section-kicker">Deterministic evaluation</span><CardTitle>{evaluation.summary}</CardTitle><CardDescription>Rules use explicit thresholds documented below. “Possible” means the required comparison is missing or ownership remains ambiguous.</CardDescription></CardHeader>
        <CardContent className="priority-findings">
          {evaluation.prioritized.length === 0 ? <div className="honest-empty">No cause is supported yet. Run the next controlled comparison.</div> : evaluation.prioritized.map((item) => <FindingCard key={item.id} finding={item} />)}
        </CardContent>
      </Card>
      <Card className="page-card">
        <CardHeader><CardTitle>All evaluated causes</CardTitle><CardDescription>Unsupported and unavailable causes stay visible so absence of evidence is not mistaken for a pass.</CardDescription></CardHeader>
        <CardContent><AssessmentAccordion assessments={evaluation.assessments} /></CardContent>
      </Card>
    </div>
  );
}

function FindingCard({ finding }: { finding: CauseAssessment }) {
  return (
    <article className="finding-card" data-state={finding.state}>
      <div className="finding-card__head"><span>{stateIcon(finding.state)}</span><div><Badge variant={finding.state === "supported" ? "default" : "outline"}>{humanize(finding.state)}</Badge><h3>{finding.title}</h3></div><strong>{finding.confidence}%<small>confidence</small></strong></div>
      <p>{finding.evidence[0]}</p>
      <Separator />
      <dl>
        <div><dt>Alternative</dt><dd>{finding.alternatives.join(" ")}</dd></div>
        <div><dt>Next test</dt><dd>{finding.nextTest}</dd></div>
        <div><dt>Action</dt><dd>{finding.action}</dd></div>
        <div><dt>Unlikely to help</dt><dd>{finding.unlikelyToHelp}</dd></div>
      </dl>
    </article>
  );
}

function AssessmentAccordion({ assessments }: { assessments: CauseAssessment[] }) {
  return (
    <Accordion type="multiple" className="assessment-accordion">
      {assessments.map((item) => (
        <AccordionItem key={item.id} value={item.id}>
          <AccordionTrigger><span className="assessment-title">{stateIcon(item.state)}<span><strong>{item.title}</strong><small>{humanize(item.state)} · {item.confidence}% confidence</small></span></span></AccordionTrigger>
          <AccordionContent>
            <div className="assessment-detail">
              <DetailList title="Evidence" items={item.evidence} />
              <DetailList title="Alternatives" items={item.alternatives} />
              <div><h4>Next test</h4><p>{item.nextTest}</p></div>
              <div><h4>Action</h4><p>{item.action}</p></div>
              <div><h4>Unlikely to help</h4><p>{item.unlikelyToHelp}</p></div>
              <div className="method-rule"><h4>Decision rule</h4><p>{item.methodology}</p></div>
            </div>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

function DetailList({ title, items }: { title: string; items: string[] }) {
  return <div><h4>{title}</h4><ul>{items.map((item) => <li key={item}>{item}</li>)}</ul></div>;
}

function FixPlan({ evaluation, onReport }: { evaluation: ReturnType<typeof evaluateDiagnostic>; onReport: () => void }) {
  return (
    <div className="section-stack">
      <Card className="page-card">
        <CardHeader><span className="section-kicker">Prioritized and verifiable</span><CardTitle>Fix plan</CardTitle><CardDescription>Each action includes the evidence behind it and the retest needed to verify improvement.</CardDescription></CardHeader>
        <CardContent><ol className="fix-plan-list">{evaluation.fixPlan.map((item, index) => <li key={`${item.title}-${index}`}><span>{index + 1}</span><div><h3>{item.title}</h3><p>{item.reason}</p><small><RefreshCcw aria-hidden="true" /> {item.verify}</small></div></li>)}</ol></CardContent>
        <CardFooter className="fix-plan-footer"><Button onClick={onReport}><FileDown aria-hidden="true" /> Download privacy-safe report</Button></CardFooter>
      </Card>
      <Card className="page-card purchase-guidance"><CardContent><Info aria-hidden="true" /><div><strong>Before buying anything</strong><p>{evaluation.purchaseGuidance}</p></div></CardContent></Card>
    </div>
  );
}

function GuideLibrary() {
  return (
    <Card className="page-card">
      <CardHeader><span className="section-kicker">Networking concepts</span><CardTitle>Guide library</CardTitle><CardDescription>Short explanations with primary or official references. Device-specific menu paths are omitted unless an official manufacturer source is available.</CardDescription></CardHeader>
      <CardContent>
        <Accordion type="single" collapsible className="guide-accordion">
          {GUIDES.map((guide) => (
            <AccordionItem key={guide.id} value={guide.id}>
              <AccordionTrigger><span><strong>{guide.title}</strong><small>{guide.summary}</small></span></AccordionTrigger>
              <AccordionContent><div className="guide-body">{guide.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}<a href={guide.sourceUrl} target="_blank" rel="noopener noreferrer">Official reference: {guide.sourceLabel} <ArrowRight aria-hidden="true" /></a></div></AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </CardContent>
    </Card>
  );
}

function SavedSessions({ sessions, activeId, onOpen, onDelete }: { sessions: DiagnosticSession[]; activeId: string | null; onOpen: (session: DiagnosticSession) => void; onDelete: (id: string) => void }) {
  return (
    <Card className="page-card">
      <CardHeader><CardTitle>Saved diagnostic sessions</CardTitle><CardDescription>Up to 12 sessions are kept in local browser storage. Deleting one cannot be undone.</CardDescription></CardHeader>
      <CardContent className="saved-session-list">
        {sessions.map((session) => {
          const symptom = SYMPTOMS.find((item) => item.id === session.symptom)?.label ?? session.symptom;
          return <div key={session.id} data-active={activeId === session.id || undefined}><button onClick={() => onOpen(session)}><strong>{symptom}</strong><small>{new Date(session.updatedAt).toLocaleString()} · {session.runs.length} run{session.runs.length === 1 ? "" : "s"}</small></button><Button variant="ghost" size="icon" onClick={() => onDelete(session.id)} aria-label={`Delete ${symptom} diagnostic session`}><Trash2 aria-hidden="true" /></Button></div>;
        })}
      </CardContent>
    </Card>
  );
}

function comparisonIcon(kind: DiagnosticRunKind) {
  if (kind === "ethernet") return <EthernetPort aria-hidden="true" />;
  if (kind === "near-router" || kind === "original-room") return <Wifi aria-hidden="true" />;
  if (kind === "other-device") return <Laptop aria-hidden="true" />;
  if (kind === "router-restarted" || kind === "modem-restarted") return <Router aria-hidden="true" />;
  if (kind === "peak-time" || kind === "off-peak") return <Clock3 aria-hidden="true" />;
  if (kind === "vpn-off") return <ShieldAlert aria-hidden="true" />;
  return <ListChecks aria-hidden="true" />;
}

function stateIcon(state: AssessmentState) {
  if (state === "supported") return <CheckCircle2 aria-hidden="true" />;
  if (state === "not-supported") return <XCircle aria-hidden="true" />;
  if (state === "unavailable") return <FlaskConical aria-hidden="true" />;
  return <TriangleAlert aria-hidden="true" />;
}

function sessionBaselineConditions(session: DiagnosticSession | null | undefined): DiagnosticConditions {
  return session?.runs.find((run) => run.kind === "baseline")?.conditions ?? DEFAULT_CONDITIONS;
}

function buildCompletionMessage(kind: DiagnosticRunKind, observed: "IPv4" | "IPv6" | "unknown", requested: DiagnosticConditions["requestedIpFamily"]): string {
  if ((kind === "ipv4" && observed !== "IPv4") || (kind === "ipv6" && observed !== "IPv6")) {
    return `Run saved, but the provider trace reported ${observed}; it is not valid as a forced ${requested.toUpperCase()} comparison.`;
  }
  return "Real measurement saved to this local diagnostic session. Review Evidence for deterministic rule updates.";
}

function toPositiveNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function humanize(value: string): string {
  return value.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatSpeed(value: number): string {
  return value >= 100 ? String(Math.round(value)) : value.toFixed(1);
}
