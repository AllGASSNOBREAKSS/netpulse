import { Download, FileJson, FileSpreadsheet, Play, Share2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfidencePanel } from "@/components/Report";
import { LatencyTimeline, ThroughputChart } from "@/components/ResultCharts";
import { METRICS } from "@/lib/metrics";
import type { TestResult } from "@/lib/engine";
import type { Verdict } from "@/lib/verdict";
import { downloadCsvResult, downloadJson } from "@/lib/export";

const IMPACT_GROUPS: { title: string; names: string[] }[] = [
  { title: "Gaming", names: ["Competitive gaming", "Gaming while others download", "Cloud gaming"] },
  { title: "Streaming", names: ["4K streaming", "Livestreaming"] },
  { title: "Work & video calls", names: ["Video calls"] },
  { title: "Uploading", names: ["Large uploads / backups"] },
  { title: "Browsing", names: ["Everyday browsing"] },
];

export function ResultsPage({
  result,
  verdict,
  running,
  onRunTest,
  onOpenMetric,
  onShowScore,
  onShowMethod,
  onCopyReport,
  reportCopied,
}: {
  result: TestResult | null;
  verdict: Verdict | null;
  running: boolean;
  onRunTest: () => void;
  onOpenMetric: (id: string) => void;
  onShowScore: () => void;
  onShowMethod: () => void;
  onCopyReport: () => void;
  reportCopied: boolean;
}) {
  if (!result || !verdict) {
    return (
      <Card className="mx-auto mt-8 max-w-lg text-center">
        <CardHeader>
          <CardTitle className="font-display italic">Complete Analysis</CardTitle>
          <CardDescription>
            No completed test in this session yet. Run a speed test first — every chart and card
            here is built from measured samples, never simulated.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={onRunTest} disabled={running} className="gap-2">
            <Play className="size-4" /> {running ? "Testing…" : "Run a test"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const metricCards = (ids?: string[]) => (
    <section className="metrics !mt-2">
      {METRICS.filter((m) => !ids || ids.includes(m.id)).map((m) => {
        const v = m.value(result);
        const sub = m.sub ? m.sub(result) : null;
        return (
          <button key={m.id} className="metric" onClick={() => onOpenMetric(m.id)}>
            <div className="metric__label">
              {m.name}
              {m.experimental && <span className="metric__exp">exp</span>}
            </div>
            <div className="metric__value">{v ?? <span className="metric__idle">—</span>}</div>
            <div className="metric__sub">{sub ?? " "}</div>
          </button>
        );
      })}
    </section>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold italic">Complete Analysis</h1>
          <p className="text-sm text-muted-foreground">
            {new Date(result.timestamp).toLocaleString()} · {result.server.chosen.provider}{" "}
            {result.server.chosen.city ?? ""} · {result.dataUsedMB.toFixed(0)} MB measured
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={onRunTest} disabled={running} className="gap-1.5">
            <Play className="size-3.5" /> Run again
          </Button>
          <Button size="sm" variant="outline" onClick={onCopyReport} className="gap-1.5">
            <Share2 className="size-3.5" /> {reportCopied ? "Copied ✓" : "Share report"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => downloadJson(result, verdict)} className="gap-1.5">
            <FileJson className="size-3.5" /> JSON
          </Button>
          <Button size="sm" variant="outline" onClick={() => downloadCsvResult(result, verdict)} className="gap-1.5">
            <FileSpreadsheet className="size-3.5" /> CSV
          </Button>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="responsiveness">Responsiveness</TabsTrigger>
          <TabsTrigger value="impact">Real-World Impact</TabsTrigger>
          <TabsTrigger value="technical">Technical Data</TabsTrigger>
        </TabsList>

        {/* ---- Overview ---- */}
        <TabsContent value="overview" className="space-y-5 pt-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-1">
              <CardHeader className="pb-2">
                <CardDescription>Internet Health</CardDescription>
                <CardTitle className="font-display text-5xl font-extrabold italic">
                  {verdict.score}
                  <span className="text-xl text-muted-foreground">/100</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>{verdict.headline}</p>
                <button className="text-xs text-primary underline-offset-2 hover:underline" onClick={onShowScore}>
                  How this score is calculated
                </button>
              </CardContent>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardDescription>Main findings</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 text-sm sm:grid-cols-2">
                <div>
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-status-good">Working well</div>
                  <ul className="diag diag--good">
                    {verdict.good.length ? verdict.good.map((s) => <li key={s}>{s}</li>) : <li>Nothing stood out.</li>}
                  </ul>
                </div>
                <div>
                  <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-status-warn">Needs attention</div>
                  <ul className="diag diag--bad">
                    {verdict.bad.length ? verdict.bad.map((s) => <li key={s}>{s}</li>) : <li>No problems found in this run.</li>}
                  </ul>
                </div>
              </CardContent>
            </Card>
          </div>
          {metricCards(["download", "upload", "idleLatency", "bufferbloat"])}
          <ConfidencePanel confidence={result.confidence} />
        </TabsContent>

        {/* ---- Performance ---- */}
        <TabsContent value="performance" className="space-y-5 pt-4">
          {metricCards(["download", "upload", "duration", "dataUsed"])}
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-base">Download throughput</CardTitle>
              <CardDescription>250 ms measured windows — single then multi connection</CardDescription>
            </CardHeader>
            <CardContent><ThroughputChart result={result} dir="download" /></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-base">Upload throughput</CardTitle>
              <CardDescription>250 ms measured windows</CardDescription>
            </CardHeader>
            <CardContent><ThroughputChart result={result} dir="upload" /></CardContent>
          </Card>
        </TabsContent>

        {/* ---- Responsiveness ---- */}
        <TabsContent value="responsiveness" className="space-y-5 pt-4">
          {metricCards(["idleLatency", "dlLoaded", "ulLoaded", "jitter", "bufferbloat", "stability"])}
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-base">Latency timeline</CardTitle>
              <CardDescription>Every timed probe across the whole run — idle, download load, upload load</CardDescription>
            </CardHeader>
            <CardContent><LatencyTimeline result={result} /></CardContent>
          </Card>
        </TabsContent>

        {/* ---- Impact ---- */}
        <TabsContent value="impact" className="pt-4">
          <p className="mb-3 text-sm text-muted-foreground">
            Ratings are derived from this test's measurements — they are not device or app telemetry.
          </p>
          <Accordion type="multiple" defaultValue={["Gaming", "Streaming"]}>
            {IMPACT_GROUPS.map((g) => {
              const acts = verdict.activities.filter((a) => g.names.includes(a.name));
              if (!acts.length) return null;
              return (
                <AccordionItem key={g.title} value={g.title}>
                  <AccordionTrigger className="text-sm font-semibold">{g.title}</AccordionTrigger>
                  <AccordionContent>
                    <div className="activities">
                      {acts.map((a) => (
                        <div key={a.name} className="activity">
                          <span className={`grade grade--${a.grade.toLowerCase()}`}>{a.grade}</span>
                          <div>
                            <div className="activity__name">{a.name}</div>
                            <div className="activity__note">{a.note}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
            <AccordionItem value="smart-home">
              <AccordionTrigger className="text-sm font-semibold">Smart-home devices</AccordionTrigger>
              <AccordionContent className="text-sm text-muted-foreground">
                Smart-home reliability depends mostly on Wi-Fi coverage and 2.4 GHz congestion, which
                a browser can't measure — so NetPulse doesn't score it. Low jitter and stable latency
                (see Responsiveness) are good signs for smart-home responsiveness.
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          {verdict.dontBuy && (
            <div className="dontbuy mt-4">
              <span>Don't waste money on:</span> {verdict.dontBuy}
            </div>
          )}
          <div className="mt-4">
            <h3 className="verdict__h">Recommended next actions</h3>
            <ol className="actions">
              {verdict.actions.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </div>
        </TabsContent>

        {/* ---- Technical ---- */}
        <TabsContent value="technical" className="space-y-5 pt-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["ISP", result.ispLocation.ispHint ?? "unknown"],
              ["ASN", result.ispLocation.asn?.split(" ")[0] ?? "unknown"],
              ["IP version", result.ispLocation.ipFamily],
              ["Masked IP", result.ispLocation.ipMasked],
              ["Server", `${result.server.chosen.provider} ${result.server.chosen.city ?? ""}`],
              ["Distance", result.server.chosen.approxDistanceKm != null ? `~${result.server.chosen.approxDistanceKm} km` : "unknown"],
              ["Duration", `${(result.durationMs / 1000).toFixed(1)} s`],
              ["Data moved", `${result.dataUsedMB.toFixed(0)} MB`],
              ["Raw events", String(result.samples.length)],
              ["Schema", `v${result.schemaVersion}`],
              ["Browser", result.preflight.browser],
              ["Mode", result.lowData ? "Low-data" : "Full"],
            ].map(([k, v]) => (
              <Card key={k} className="py-3">
                <CardContent className="px-4">
                  <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">{k}</div>
                  <div className="mt-0.5 truncate font-mono text-sm font-semibold" title={v}>{v}</div>
                </CardContent>
              </Card>
            ))}
          </div>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Known limitations for this run</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {result.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onShowMethod} className="gap-1.5">
              <Download className="size-3.5" /> Methodology &amp; raw JSON
            </Button>
            {result.packetLoss.status === "experimental" && (
              <Badge variant="outline" className="text-muted-foreground">
                packet loss: experimental UDP-reachability check
              </Badge>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
