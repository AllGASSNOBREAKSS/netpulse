import { BarChart3, Download, FileText, Info, ReceiptText, Save, Wifi, Zap } from "lucide-react";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { createPlanRealityReport, evaluatePlanReality, isPlanProfile, loadPlanProfile, PLAN_HISTORY_MIN_CONFIDENCE, savePlanProfile, type ConnectionMedium, type PlanProfile } from "../lib/planReality";
import type { HistoryEntry } from "../lib/history";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

type ProfileForm = { isp: string; planName: string; advertisedDownload: string; advertisedUpload: string; monthlyPrice: string; dataAllowance: string; connectionType: string };

export function PlanRealityCheck({ history, onHistoryChange }: { history: HistoryEntry[]; onHistoryChange: (history: HistoryEntry[]) => void }) {
  const initial = loadPlanProfile();
  const [profile, setProfile] = useState<PlanProfile | null>(initial);
  const [form, setForm] = useState<ProfileForm>(() => formFromProfile(initial));
  const [status, setStatus] = useState<string | null>(null);
  const result = useMemo(() => profile ? evaluatePlanReality(profile, history) : null, [history, profile]);

  const save = (event: FormEvent) => {
    event.preventDefault();
    const candidate = profileFromForm(form);
    if (!candidate || !isPlanProfile(candidate)) {
      setStatus("Enter a valid ISP, plan name, connection type, and listed download rate. Numeric values must be positive and within the displayed units.");
      return;
    }
    savePlanProfile(candidate);
    setProfile(candidate);
    setStatus("Plan details saved only in this browser.");
  };

  const updateMedium = (timestamp: number, medium: ConnectionMedium) => {
    onHistoryChange(history.map((entry) => entry.ts === timestamp ? { ...entry, connectionMedium: medium } : entry));
  };

  const downloadReport = () => {
    if (!profile || !result) return;
    const blob = new Blob([createPlanRealityReport(profile, result)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "netpulse-plan-reality-report.txt";
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus("Support-ready text report downloaded.");
  };

  return <section className="plan-reality" aria-labelledby="plan-reality-title">
    <Card className="plan-reality-hero">
      <CardHeader><Badge variant="outline"><ReceiptText aria-hidden="true" /> Local history analysis</Badge><CardTitle id="plan-reality-title">ISP Plan Reality Check</CardTitle><CardDescription>Compare only sufficiently confident tests saved on this device. Results are measurement summaries, not a legal or contractual finding.</CardDescription></CardHeader>
      <CardContent>
        <form className="plan-profile-form" onSubmit={save}>
          <PlanField label="ISP"><Input value={form.isp} onChange={(event) => setForm({ ...form, isp: event.target.value })} minLength={2} maxLength={80} required /></PlanField>
          <PlanField label="Plan name"><Input value={form.planName} onChange={(event) => setForm({ ...form, planName: event.target.value })} maxLength={80} required /></PlanField>
          <PlanField label="Listed download (Mbps)"><Input type="number" inputMode="decimal" min="0.1" max="100000" step="0.1" value={form.advertisedDownload} onChange={(event) => setForm({ ...form, advertisedDownload: event.target.value })} required /></PlanField>
          <PlanField label="Listed upload (Mbps)"><Input type="number" inputMode="decimal" min="0.1" max="100000" step="0.1" value={form.advertisedUpload} onChange={(event) => setForm({ ...form, advertisedUpload: event.target.value })} placeholder="Optional" /></PlanField>
          <PlanField label="Monthly price"><Input type="number" inputMode="decimal" min="0" max="1000000" step="0.01" value={form.monthlyPrice} onChange={(event) => setForm({ ...form, monthlyPrice: event.target.value })} placeholder="Optional" /></PlanField>
          <PlanField label="Data allowance (GB)"><Input type="number" inputMode="decimal" min="0.1" max="1000000000" step="0.1" value={form.dataAllowance} onChange={(event) => setForm({ ...form, dataAllowance: event.target.value })} placeholder="Optional / unlimited" /></PlanField>
          <PlanField label="Connection type"><Input value={form.connectionType} onChange={(event) => setForm({ ...form, connectionType: event.target.value })} maxLength={80} placeholder="Fiber, cable, DSL…" required /></PlanField>
          <Button type="submit"><Save aria-hidden="true" /> Save local plan</Button>
        </form>
        {status && <p className="plan-status" role="status">{status}</p>}
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle>Test conditions</CardTitle><CardDescription>Browsers cannot reliably detect Wi-Fi versus Ethernet. These labels are explicitly user supplied and affect only the comparison below.</CardDescription></CardHeader>
      <CardContent className="plan-test-list">
        {history.length === 0 ? <p className="empty-copy">No saved tests are available. Run speed tests under representative wired and Wi-Fi conditions.</p> : history.slice(0, 20).map((entry) => <div key={entry.ts}>
          <div><strong>{new Date(entry.ts).toLocaleString()}</strong><p>{format(entry.down)} Mbps down · confidence {entry.confidence ?? 0}/100 {entry.confidence !== undefined && entry.confidence >= PLAN_HISTORY_MIN_CONFIDENCE ? "· eligible" : "· excluded"}</p></div>
          <Select value={entry.connectionMedium ?? "unknown"} onValueChange={(value) => updateMedium(entry.ts, value as ConnectionMedium)}><SelectTrigger aria-label={`Connection medium for test ${new Date(entry.ts).toLocaleString()}`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unknown">Unknown</SelectItem><SelectItem value="wifi">Wi-Fi</SelectItem><SelectItem value="ethernet">Ethernet</SelectItem><SelectItem value="mobile">Mobile</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent></Select>
        </div>)}
      </CardContent>
    </Card>

    {profile && result && <>
      <div className="plan-stat-grid">
        <PlanStat icon={Download} label="Median download" value={`${format(result.medianDownloadMbps)} Mbps`} detail={`${format(result.deliveredDownloadPct)}% of ${format(profile.advertisedDownloadMbps)} Mbps listed`} />
        <PlanStat icon={Zap} label="Median upload" value={`${format(result.medianUploadMbps)} Mbps`} detail={result.deliveredUploadPct === null ? "No listed upload rate provided" : `${format(result.deliveredUploadPct)}% of listed upload`} />
        <PlanStat icon={BarChart3} label="Reliability indicator" value={`${result.reliabilityScore}/100`} detail="Consistency + run stability + loaded-latency quality; not uptime" />
        <PlanStat icon={FileText} label="Valid tests" value={String(result.validTests.length)} detail={`${result.excludedLowConfidence} low-confidence · ${result.excludedInvalid} invalid excluded`} />
      </div>

      <Card>
        <CardHeader><CardTitle>Measured comparisons</CardTitle><CardDescription>Medians require at least two tests in each peak/off-peak or Wi-Fi/Ethernet group.</CardDescription></CardHeader>
        <CardContent className="plan-comparison-grid">
          <Comparison label="Peak-hour median" value={formatOptional(result.peakHourMedianMbps, "Mbps")} note="6:00 PM–10:59 PM in the timezone recorded at test time" />
          <Comparison label="Off-peak median" value={formatOptional(result.offPeakMedianMbps, "Mbps")} note="All other locally recorded test hours" />
          <Comparison label="Ethernet median" value={formatOptional(result.wiredMedianMbps, "Mbps")} note="User-labeled Ethernet tests only" />
          <Comparison label="Wi-Fi median" value={formatOptional(result.wifiMedianMbps, "Mbps")} note={result.wifiVsWiredDifferencePct === null ? "User-labeled Wi-Fi tests only" : `${format(result.wifiVsWiredDifferencePct)}% below the wired median`} />
          <Comparison label="Download-loaded rise" value={formatOptional(result.loadedDownRiseMs, "ms")} note="Median loaded latency minus idle latency" />
          <Comparison label="Upload-loaded rise" value={formatOptional(result.loadedUpRiseMs, "ms")} note="Median loaded latency minus idle latency" />
        </CardContent>
        <CardFooter className="plan-method"><Info aria-hidden="true" /><div><strong>Formula and limitations</strong><p>{result.reliabilityFormula}</p><p>Outage duration is not inferred from discrete test history. Use Connection Black Box for a separate measured interruption report.</p></div><Button variant="outline" onClick={downloadReport}><Download aria-hidden="true" /> Download report</Button></CardFooter>
      </Card>
    </>}
  </section>;
}

function PlanField({ label, children }: { label: string; children: ReactNode }) { return <label className="field-stack"><span>{label}</span>{children}</label>; }

function PlanStat({ icon: Icon, label, value, detail }: { icon: typeof Wifi; label: string; value: string; detail: string }) { return <Card><CardContent><Icon aria-hidden="true" /><span>{label}</span><strong>{value}</strong><p>{detail}</p></CardContent></Card>; }

function Comparison({ label, value, note }: { label: string; value: string; note: string }) { return <div><span>{label}</span><strong>{value}</strong><p>{note}</p></div>; }

function profileFromForm(form: ProfileForm): PlanProfile | null {
  const advertisedDownloadMbps = parseRequired(form.advertisedDownload);
  if (advertisedDownloadMbps === null) return null;
  return { isp: form.isp.trim(), planName: form.planName.trim(), advertisedDownloadMbps, advertisedUploadMbps: parseOptional(form.advertisedUpload), monthlyPrice: parseOptional(form.monthlyPrice), dataAllowanceGb: parseOptional(form.dataAllowance), connectionType: form.connectionType.trim() };
}

function formFromProfile(profile: PlanProfile | null): ProfileForm { return profile ? { isp: profile.isp, planName: profile.planName, advertisedDownload: String(profile.advertisedDownloadMbps), advertisedUpload: profile.advertisedUploadMbps === null ? "" : String(profile.advertisedUploadMbps), monthlyPrice: profile.monthlyPrice === null ? "" : String(profile.monthlyPrice), dataAllowance: profile.dataAllowanceGb === null ? "" : String(profile.dataAllowanceGb), connectionType: profile.connectionType } : { isp: "", planName: "", advertisedDownload: "", advertisedUpload: "", monthlyPrice: "", dataAllowance: "", connectionType: "" }; }
function parseRequired(value: string): number | null { const parsed = Number(value); return value.trim() && Number.isFinite(parsed) ? parsed : null; }
function parseOptional(value: string): number | null { return value.trim() ? Number(value) : null; }
function format(value: number): string { return value >= 100 ? String(Math.round(value)) : value.toFixed(1); }
function formatOptional(value: number | null, unit: string): string { return value === null ? "Insufficient data" : `${format(value)} ${unit}`; }
