import { useMemo, useState } from "react";
import { AlertTriangle, BarChart3, CheckCircle2, FileJson, ShieldCheck } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  groupValidationRuns,
  parseValidationDataset,
  summarizeValidationRuns,
  type ValidationDataset,
  type ValidationRun,
} from "@/lib/validationLab";

type Dimension = "speed" | "browser" | "region" | "endpoint";
type SourceFile = { name: string; modifiedAt: string; rows: number };

const EMPTY_DATASET: ValidationDataset = { accepted: [], rejected: [], duplicates: [] };
const REQUIRED_SPEEDS = [1, 5, 10, 25, 50, 100, 500, 1_000];
const REQUIRED_NATIVE_BROWSERS: ValidationRun["environment"]["browser"][] = ["chrome", "edge", "firefox", "safari"];

const accuracyConfig = {
  downloadMedianErrorPct: { label: "Download median absolute error", color: "var(--chart-1)" },
  uploadMedianErrorPct: { label: "Upload median absolute error", color: "var(--chart-3)" },
} satisfies ChartConfig;

const reliabilityConfig = {
  completionRatePct: { label: "Completion rate", color: "var(--chart-2)" },
  downloadFailureRatePct: { label: "Download failure rate", color: "var(--chart-5)" },
  uploadFailureRatePct: { label: "Upload failure rate", color: "var(--chart-3)" },
} satisfies ChartConfig;

const variationConfig = {
  downloadVariationPct: { label: "Download CoV", color: "var(--chart-1)" },
  uploadVariationPct: { label: "Upload CoV", color: "var(--chart-3)" },
} satisfies ChartConfig;

const distributionConfig = {
  count: { label: "Runs", color: "var(--chart-1)" },
} satisfies ChartConfig;

const dataUseConfig = {
  meanDataMB: { label: "Mean application payload", color: "var(--chart-4)" },
} satisfies ChartConfig;

const browserImpactConfig = {
  longTaskTotalMs: { label: "Mean long-task time", color: "var(--chart-3)" },
  maxFrameDelayMs: { label: "Mean maximum frame delay", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function ValidationDashboard() {
  const [dataset, setDataset] = useState<ValidationDataset>(EMPTY_DATASET);
  const [sources, setSources] = useState<SourceFile[]>([]);
  const [dimension, setDimension] = useState<Dimension>("speed");
  const [status, setStatus] = useState<"all" | ValidationRun["outcome"]["status"]>("all");
  const [loadError, setLoadError] = useState<string | null>(null);

  const filtered = useMemo(
    () => dataset.accepted.filter((run) => status === "all" || run.outcome.status === status),
    [dataset.accepted, status],
  );
  const groups = useMemo(() => groupValidationRuns(filtered, dimension), [filtered, dimension]);
  const total = useMemo(() => summarizeValidationRuns(filtered), [filtered]);
  const confidence = useMemo(() => confidenceDistribution(filtered), [filtered]);
  const endpointHealth = useMemo(() => countBy(filtered, (run) => run.outcome.endpointHealthStatus), [filtered]);
  const packetLoss = useMemo(() => countBy(filtered, (run) => run.outcome.packetLossStatus), [filtered]);
  const browserImpact = useMemo(() => performanceByBrowser(filtered), [filtered]);
  const launch = useMemo(() => launchReadiness(dataset.accepted), [dataset.accepted]);

  const loadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const rows: unknown[] = [];
      const nextSources: SourceFile[] = [];
      for (const file of Array.from(files)) {
        const parsed = parseResultFile(await file.text());
        rows.push(...parsed);
        nextSources.push({ name: file.name, modifiedAt: new Date(file.lastModified).toISOString(), rows: parsed.length });
      }
      setDataset(parseValidationDataset(rows));
      setSources(nextSources);
      setLoadError(null);
    } catch (error) {
      setDataset(EMPTY_DATASET);
      setSources([]);
      setLoadError(error instanceof Error ? error.message : "The selected files could not be parsed.");
    }
  };

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-8 lg:px-12">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-6">
        <header className="flex flex-col gap-5 border-b border-border pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="font-display text-xs font-semibold uppercase tracking-[0.22em] text-primary">Internal engineering</p>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight sm:text-4xl">NetPulse accuracy laboratory</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              One row is one controlled NetPulse run with an independent iperf3/ping baseline. This local dashboard never uploads files and rejects direct IP or exact-location fields.
            </p>
          </div>
          <label className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground outline-none ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
            <FileJson className="size-4" aria-hidden="true" />
            Load result JSON
            <input className="sr-only" type="file" accept=".json,.jsonl,application/json" multiple onChange={(event) => void loadFiles(event.target.files)} />
          </label>
        </header>

        {loadError && <Notice tone="bad" title="Dataset could not be loaded">{loadError}</Notice>}

        {dataset.accepted.length === 0 ? (
          <Card className="border-dashed">
            <CardHeader>
              <CardTitle>No validated runs loaded</CardTitle>
              <CardDescription>Run the controlled lab, then choose JSON files from lab/results. No sample values are rendered.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
              <EmptyStep number="1" text="Start Docker Desktop and run the smoke matrix." />
              <EmptyStep number="2" text="Inspect failures and repeat each required segment at least ten times." />
              <EmptyStep number="3" text="Load the retained result files here for quality and launch-gate review." />
            </CardContent>
          </Card>
        ) : (
          <>
            <section aria-labelledby="launch-gate-heading" className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
              <Card>
                <CardHeader>
                  <CardTitle id="launch-gate-heading" className="flex items-center gap-2">
                    {launch.ready ? <CheckCircle2 className="size-5 text-status-good" /> : <AlertTriangle className="size-5 text-status-warn" />}
                    {launch.ready ? "Controlled launch gate passed" : "Public launch evidence is incomplete"}
                  </CardTitle>
                  <CardDescription>{launch.summary}</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="grid gap-2 text-sm text-muted-foreground">
                    {launch.missing.map((item) => <li key={item}>• {item}</li>)}
                  </ul>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Dataset quality</CardTitle>
                  <CardDescription>Accepted and rejected before any aggregation.</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-3 gap-3">
                  <Kpi label="Accepted" value={dataset.accepted.length.toLocaleString()} />
                  <Kpi label="Rejected" value={dataset.rejected.length.toLocaleString()} />
                  <Kpi label="Duplicates" value={dataset.duplicates.length.toLocaleString()} />
                </CardContent>
              </Card>
            </section>

            <section aria-label="Dashboard filters" className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4">
              <Filter label="Group charts by">
                <Select value={dimension} onValueChange={(value) => setDimension(value as Dimension)}>
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="speed">Speed tier</SelectItem>
                    <SelectItem value="browser">Browser + version</SelectItem>
                    <SelectItem value="region">Region</SelectItem>
                    <SelectItem value="endpoint">Endpoint</SelectItem>
                  </SelectContent>
                </Select>
              </Filter>
              <Filter label="Run status">
                <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="complete">Complete</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                    <SelectItem value="aborted">Aborted</SelectItem>
                  </SelectContent>
                </Select>
              </Filter>
              <Button variant="outline" onClick={() => { setDataset(EMPTY_DATASET); setSources([]); }}>Clear local data</Button>
            </section>

            <section aria-label="Headline metrics" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
              <KpiCard label="Runs" value={total.runs.toLocaleString()} detail={`${total.completeRuns} complete`} />
              <KpiCard label="Completion" value={formatPct(total.completionRatePct)} detail="All retained attempts" />
              <KpiCard label="Download median error" value={formatPct(total.downloadMedianErrorPct)} detail="Absolute vs iperf3" />
              <KpiCard label="Download P95 error" value={formatPct(total.downloadP95ErrorPct)} detail="Absolute vs iperf3" />
              <KpiCard label="Confidence Brier" value={formatNumber(total.confidenceBrierScore, 3)} detail="Lower is better" />
              <KpiCard label="Mean data" value={total.meanDataMB === null ? "Unavailable" : `${total.meanDataMB.toFixed(1)} MB`} detail="Application payload" />
            </section>

            <section className="grid gap-5 xl:grid-cols-2">
              <DashboardChart
                title={`Accuracy error by ${dimension}`}
                description="Median absolute percent error against the independent iperf3 baseline. Bars are omitted when the baseline is missing."
                data={groups}
                config={accuracyConfig}
                bars={["downloadMedianErrorPct", "uploadMedianErrorPct"]}
                unit="%"
              />
              <DashboardChart
                title={`Completion and failures by ${dimension}`}
                description="Every attempt remains in the denominator; failed tests are not silently dropped."
                data={groups}
                config={reliabilityConfig}
                bars={["completionRatePct", "downloadFailureRatePct", "uploadFailureRatePct"]}
                unit="%"
              />
              <DashboardChart
                title={`Test-to-test variation by ${dimension}`}
                description="Coefficient of variation across completed headline throughput results; at least two runs are required."
                data={groups}
                config={variationConfig}
                bars={["downloadVariationPct", "uploadVariationPct"]}
                unit="%"
              />
              <DashboardChart
                title="Confidence distribution"
                description="Run counts by reported confidence bucket. Calibration is assessed separately with the Brier score."
                data={confidence}
                config={distributionConfig}
                bars={["count"]}
                unit="runs"
              />
              <DashboardChart
                title="Endpoint health observed at selection"
                description="Health is the endpoint report accepted by the selection layer, not an inference from user throughput."
                data={endpointHealth}
                config={distributionConfig}
                bars={["count"]}
                unit="runs"
              />
              <DashboardChart
                title="Packet-loss result validity"
                description="Browser UDP reachability is not a loss percentage. NetPulse results stay unavailable until a validated echo measurement exists."
                data={packetLoss}
                config={distributionConfig}
                bars={["count"]}
                unit="runs"
              />
              <DashboardChart
                title={`Data use by ${dimension}`}
                description="Mean application payload reported by completed NetPulse runs; transport and protocol overhead are not included."
                data={groups}
                config={dataUseConfig}
                bars={["meanDataMB"]}
                unit="MB"
              />
              <DashboardChart
                title="Browser rendering impact"
                description="Long-task and requestAnimationFrame-delay telemetry collected while the full UI runs. Unsupported APIs remain null."
                data={browserImpact}
                config={browserImpactConfig}
                bars={["longTaskTotalMs", "maxFrameDelayMs"]}
                unit="ms"
              />
            </section>

            <section className="grid gap-5 xl:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Source files and freshness</CardTitle>
                  <CardDescription>Files are read locally and are never transmitted by this dashboard.</CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full min-w-[32rem] text-left text-sm">
                    <thead className="text-muted-foreground"><tr><th className="pb-2">File</th><th>Rows</th><th>Last modified</th></tr></thead>
                    <tbody>{sources.map((source) => <tr key={`${source.name}-${source.modifiedAt}`} className="border-t border-border"><td className="py-2 font-mono text-xs">{source.name}</td><td>{source.rows}</td><td>{new Date(source.modifiedAt).toLocaleString()}</td></tr>)}</tbody>
                  </table>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Rejected evidence</CardTitle>
                  <CardDescription>Malformed, duplicate, or privacy-unsafe rows cannot influence charts.</CardDescription>
                </CardHeader>
                <CardContent>
                  {dataset.rejected.length === 0 ? <p className="text-sm text-muted-foreground">No rows were rejected.</p> : (
                    <ul className="max-h-64 space-y-2 overflow-auto text-sm text-muted-foreground">
                      {dataset.rejected.map((item) => <li key={`${item.index}-${item.runId ?? "unknown"}`}><span className="font-mono text-xs text-foreground">{item.runId ?? `row ${item.index}`}</span>: {item.reasons.join(" ")}</li>)}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </section>
          </>
        )}

        <footer className="flex items-center gap-2 border-t border-border pt-5 text-xs text-muted-foreground">
          <ShieldCheck className="size-4" aria-hidden="true" />
          Internal validation surface · no account data, raw IP, or exact location accepted
        </footer>
      </div>
    </main>
  );
}

function DashboardChart({ title, description, data, config, bars, unit }: {
  title: string;
  description: string;
  data: Record<string, unknown>[];
  config: ChartConfig;
  bars: string[];
  unit: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><BarChart3 className="size-4 text-primary" />{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? <p className="py-16 text-center text-sm text-muted-foreground">No qualifying measurements.</p> : (
          <>
            <ChartContainer config={config} className="h-[300px] w-full aspect-auto" initialDimension={{ width: 640, height: 300 }}>
              <BarChart accessibilityLayer data={data} margin={{ top: 10, right: 8, bottom: 40, left: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="key" angle={-22} textAnchor="end" interval={0} height={64} />
                <YAxis unit={unit === "%" ? "%" : undefined} />
                <ChartTooltip content={<ChartTooltipContent />} />
                {bars.map((bar) => <Bar key={bar} dataKey={bar} fill={`var(--color-${bar})`} radius={3} />)}
              </BarChart>
            </ChartContainer>
            <details className="mt-3 text-xs text-muted-foreground">
              <summary className="cursor-pointer font-semibold text-foreground">Exact values and sample counts</summary>
              <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[34rem] text-left"><thead><tr><th>Segment</th><th>Runs</th>{bars.map((bar) => <th key={bar}>{config[bar]?.label ?? bar}</th>)}</tr></thead><tbody>{data.map((row) => <tr className="border-t border-border" key={String(row.key)}><td className="py-2">{String(row.key)}</td><td>{String(row.runs ?? row.count ?? "—")}</td>{bars.map((bar) => <td key={bar}>{formatCell(row[bar], unit)}</td>)}</tr>)}</tbody></table></div>
            </details>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function launchReadiness(runs: ValidationRun[]) {
  const speedGroups = new Map<number, ValidationRun[]>();
  for (const run of runs) {
    const group = speedGroups.get(run.condition.downloadMbps) ?? [];
    group.push(run);
    speedGroups.set(run.condition.downloadMbps, group);
  }
  const missing: string[] = [];
  for (const speed of REQUIRED_SPEEDS) {
    const group = speedGroups.get(speed) ?? [];
    const summary = summarizeValidationRuns(group);
    if (group.length < 10) missing.push(`${speed} Mbps needs ${10 - group.length} more controlled repetition${10 - group.length === 1 ? "" : "s"}.`);
    else if (!summary.passesLaunchGate) missing.push(`${speed} Mbps does not meet the accuracy, repeatability, latency, or failure-rate gate.`);
  }
  for (const browser of REQUIRED_NATIVE_BROWSERS) {
    if (!runs.some((run) => run.environment.browser === browser)) missing.push(`Native ${browser} evidence is missing; Playwright ${browser === "safari" ? "WebKit is not Safari" : "engines are not a substitute"}.`);
  }
  const hasNativeMobile = runs.some((run) => ["mobile", "tablet"].includes(run.environment.deviceClass) && !run.environment.operatingSystem.includes("container"));
  if (!hasNativeMobile) missing.push("Native Android/iOS mobile-device evidence is missing.");
  return {
    ready: missing.length === 0,
    missing,
    summary: missing.length === 0
      ? "Every required controlled speed tier and native browser/device gate has recorded evidence. Review per-segment failures before release."
      : `${missing.length} evidence gate${missing.length === 1 ? "" : "s"} remain. Container runs alone cannot justify a global accuracy claim.`,
  };
}

function parseResultFile(text: string): unknown[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    if (typeof parsed === "object" && parsed !== null && "runs" in parsed && Array.isArray(parsed.runs)) return parsed.runs;
    return [parsed];
  } catch {
    return trimmed.split(/\r?\n/).filter(Boolean).map((line, index) => {
      try { return JSON.parse(line); }
      catch { throw new Error(`Invalid JSON on line ${index + 1}.`); }
    });
  }
}

function confidenceDistribution(runs: ValidationRun[]): Record<string, unknown>[] {
  const buckets = [
    { key: "0–59", min: 0, max: 59 },
    { key: "60–74", min: 60, max: 74 },
    { key: "75–84", min: 75, max: 84 },
    { key: "85–100", min: 85, max: 100 },
  ];
  return buckets.map((bucket) => ({ ...bucket, count: runs.filter((run) => run.outcome.confidenceScore !== null && run.outcome.confidenceScore >= bucket.min && run.outcome.confidenceScore <= bucket.max).length }));
}

function countBy(runs: ValidationRun[], key: (run: ValidationRun) => string): Record<string, unknown>[] {
  const counts = new Map<string, number>();
  for (const run of runs) counts.set(key(run), (counts.get(key(run)) ?? 0) + 1);
  return [...counts.entries()].map(([name, count]) => ({ key: name, count }));
}

function performanceByBrowser(runs: ValidationRun[]): Record<string, unknown>[] {
  const groups = new Map<string, ValidationRun[]>();
  for (const run of runs) {
    const key = `${run.environment.browser} ${run.environment.browserVersion}`.trim();
    const group = groups.get(key) ?? [];
    group.push(run);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, group]) => {
    const longTasks = group.flatMap((run) => run.performance.longTaskTotalMs === null ? [] : [run.performance.longTaskTotalMs]);
    const frameDelays = group.flatMap((run) => run.performance.maxFrameDelayMs === null ? [] : [run.performance.maxFrameDelayMs]);
    return {
      key,
      runs: group.length,
      longTaskTotalMs: longTasks.length ? longTasks.reduce((sum, value) => sum + value, 0) / longTasks.length : null,
      maxFrameDelayMs: frameDelays.length ? frameDelays.reduce((sum, value) => sum + value, 0) / frameDelays.length : null,
    };
  });
}

function KpiCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <Card><CardContent className="pt-5"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p><p className="mt-2 font-mono text-2xl font-semibold tabular-nums">{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></CardContent></Card>;
}

function Kpi({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-mono text-xl font-semibold tabular-nums">{value}</p></div>;
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="grid gap-1.5 text-xs font-semibold text-muted-foreground">{label}{children}</label>;
}

function EmptyStep({ number, text }: { number: string; text: string }) {
  return <div className="rounded-md border border-border p-4"><span className="font-mono text-primary">{number}</span><p className="mt-2 leading-5">{text}</p></div>;
}

function Notice({ title, children }: { tone: "bad"; title: string; children: React.ReactNode }) {
  return <div role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-4"><p className="font-semibold">{title}</p><p className="mt-1 text-sm text-muted-foreground">{children}</p></div>;
}

function formatPct(value: number | null): string {
  return value === null ? "Unavailable" : `${value.toFixed(1)}%`;
}

function formatNumber(value: number | null, digits: number): string {
  return value === null ? "Unavailable" : value.toFixed(digits);
}

function formatCell(value: unknown, unit: string): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(2)}${unit === "%" ? "%" : unit === "runs" ? "" : ` ${unit}`}` : "Unavailable";
}
