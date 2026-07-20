import { Download, FileJson, FileSpreadsheet, ListChecks, Play, Share2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfidencePanel } from "@/components/Report";
import { LatencyTimeline, ThroughputChart } from "@/components/ResultCharts";
import {
  EmptyState,
  KeyValueList,
  PageHeader,
  Panel,
  Section,
  StatGrid,
  type Stat,
} from "@/components/np/Layout";
import { METRICS } from "@/lib/metrics";
import type { TestResult } from "@/lib/engine";
import type { Verdict } from "@/lib/verdict";
import { downloadCsvResult, downloadJson } from "@/lib/export";

const IMPACT_GROUPS: { title: string; names: string[] }[] = [
  { title: "Gaming", names: ["Competitive gaming", "Gaming while others download", "Cloud gaming"] },
  { title: "Streaming", names: ["4K streaming", "Livestreaming"] },
  { title: "Video calls & remote work", names: ["Video calls"] },
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
      <div className="space-y-8">
        <PageHeader
          title="Complete Analysis"
          description="Every chart and figure on this page is built from measured samples of your own connection."
        />
        <EmptyState
          icon={ListChecks}
          title="No completed test in this session yet"
          description="Run a speed test and the full analysis — throughput windows, latency under load, bufferbloat and real-world impact — is generated from those measurements."
          action={
            <Button onClick={onRunTest} disabled={running} className="gap-2">
              <Play className="size-4" /> {running ? "Testing…" : "Run a test"}
            </Button>
          }
        />
      </div>
    );
  }

  /** Metric cells that drill into the "how this is measured" detail modal. */
  const metricStats = (ids: string[]): Stat[] =>
    METRICS.filter((m) => ids.includes(m.id)).map((m) => ({
      label: m.name,
      value: m.value(result) ?? "—",
      hint: m.sub?.(result) ?? undefined,
      badge: m.experimental ? "EXP" : undefined,
      onClick: () => onOpenMetric(m.id),
    }));

  const tabCls =
    "data-[state=active]:bg-card data-[state=active]:text-foreground text-[13px] transition-colors";

  return (
    <div className="space-y-8">
      <PageHeader
        title="Complete Analysis"
        description={
          <>
            {new Date(result.timestamp).toLocaleString()} · {result.server.chosen.provider}{" "}
            {result.server.chosen.edgeCode ?? ""} · {result.dataUsedMB.toFixed(0)} MB measured
          </>
        }
        actions={
          <>
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
          </>
        }
      />

      <Tabs defaultValue="overview" className="gap-6">
        <TabsList className="h-auto flex-wrap justify-start gap-1 bg-muted/50 p-1">
          <TabsTrigger value="overview" className={tabCls}>Overview</TabsTrigger>
          <TabsTrigger value="performance" className={tabCls}>Performance</TabsTrigger>
          <TabsTrigger value="responsiveness" className={tabCls}>Responsiveness</TabsTrigger>
          <TabsTrigger value="impact" className={tabCls}>Real-World Impact</TabsTrigger>
          <TabsTrigger value="technical" className={tabCls}>Technical Data</TabsTrigger>
        </TabsList>

        {/* ------------------------------ Overview ------------------------- */}
        <TabsContent value="overview" className="space-y-8">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
            <Panel className="flex flex-col justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Internet Health
                </p>
                <p className="mt-2 flex items-baseline gap-2">
                  <span className="font-display text-[54px] font-bold leading-none tracking-tight tabular-nums">
                    {verdict.score}
                  </span>
                  <span className="text-lg text-muted-foreground">/100</span>
                </p>
                <p className="mt-3 text-[14px] leading-relaxed">{verdict.headline}</p>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground">
                <span>Confidence {result.confidence.score}%</span>
                <button
                  className="text-primary underline-offset-4 transition-colors hover:underline"
                  onClick={onShowScore}
                >
                  How this score is calculated
                </button>
              </div>
            </Panel>

            <Panel className="space-y-5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Connection identity
                </p>
                <KeyValueList
                  className="mt-2"
                  items={[
                    { k: "ISP", v: result.ispLocation.ispHint ?? "not identified", mono: false },
                    { k: "Masked IP", v: result.ispLocation.ipMasked },
                    {
                      k: "Approx. area",
                      v:
                        [result.ispLocation.city, result.ispLocation.region, result.ispLocation.country]
                          .filter(Boolean)
                          .join(", ") || "not available",
                      mono: false,
                    },
                  ]}
                />
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-status-good">
                    Working well
                  </p>
                  <ul className="diag diag--good">
                    {verdict.good.length ? (
                      verdict.good.map((s) => <li key={s}>{s}</li>)
                    ) : (
                      <li>Nothing stood out.</li>
                    )}
                  </ul>
                </div>
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-status-warn">
                    Needs attention
                  </p>
                  <ul className="diag diag--bad">
                    {verdict.bad.length ? (
                      verdict.bad.map((s) => <li key={s}>{s}</li>)
                    ) : (
                      <li>No problems found in this run.</li>
                    )}
                  </ul>
                </div>
              </div>
            </Panel>
          </div>

          <Section title="Headline measurements" description="Select any figure to see how it was measured.">
            <StatGrid stats={metricStats(["download", "upload", "idleLatency", "bufferbloat"])} />
          </Section>

          <ConfidencePanel confidence={result.confidence} />
        </TabsContent>

        {/* ---------------------------- Performance ------------------------ */}
        <TabsContent value="performance" className="space-y-8">
          <StatGrid stats={metricStats(["download", "upload", "duration", "dataUsed"])} />

          <Section
            title="Download throughput"
            description="250 ms measured windows — single connection, then multi connection."
          >
            <Panel padded={false} className="p-4 sm:p-5">
              <ThroughputChart result={result} dir="download" />
            </Panel>
          </Section>

          <Section title="Upload throughput" description="250 ms measured windows.">
            <Panel padded={false} className="p-4 sm:p-5">
              <ThroughputChart result={result} dir="upload" />
            </Panel>
          </Section>
        </TabsContent>

        {/* -------------------------- Responsiveness ----------------------- */}
        <TabsContent value="responsiveness" className="space-y-8">
          <StatGrid
            stats={metricStats(["idleLatency", "dlLoaded", "ulLoaded", "jitter", "bufferbloat", "stability"])}
            columns={3}
          />
          <Section
            title="Latency timeline"
            description="Every timed probe across the whole run — idle, under download load, under upload load."
          >
            <Panel padded={false} className="p-4 sm:p-5">
              <LatencyTimeline result={result} />
            </Panel>
          </Section>
        </TabsContent>

        {/* ------------------------------- Impact -------------------------- */}
        <TabsContent value="impact" className="space-y-6">
          <p className="max-w-2xl text-[13.5px] leading-relaxed text-muted-foreground">
            Ratings are derived from this test's own measurements — they are not device or
            application telemetry.
          </p>

          <Accordion type="multiple" defaultValue={["Gaming", "Streaming"]} className="rounded-xl border border-border bg-card px-5">
            {IMPACT_GROUPS.map((g) => {
              const acts = verdict.activities.filter((a) => g.names.includes(a.name));
              if (!acts.length) return null;
              return (
                <AccordionItem key={g.title} value={g.title}>
                  <AccordionTrigger className="text-[14px] font-semibold hover:no-underline">
                    {g.title}
                  </AccordionTrigger>
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
            <AccordionItem value="smart-home" className="border-b-0">
              <AccordionTrigger className="text-[14px] font-semibold hover:no-underline">
                Smart-home devices
              </AccordionTrigger>
              <AccordionContent className="text-[13.5px] leading-relaxed text-muted-foreground">
                Smart-home reliability depends mostly on Wi-Fi coverage and 2.4 GHz congestion, which
                a browser cannot measure — so NetPulse does not score it. Low jitter and stable
                latency (see Responsiveness) are good signs for smart-home responsiveness.
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          {verdict.dontBuy && (
            <div className="dontbuy">
              <span>Don't waste money on:</span> {verdict.dontBuy}
            </div>
          )}

          <Section title="Recommended next actions">
            <ol className="actions">
              {verdict.actions.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </Section>
        </TabsContent>

        {/* ------------------------------ Technical ------------------------ */}
        <TabsContent value="technical" className="space-y-8">
          <StatGrid
            size="sm"
            stats={[
              { label: "ISP", value: result.ispLocation.ispHint ?? "unknown", mono: false },
              { label: "ASN", value: result.ispLocation.asn?.split(" ")[0] ?? "unknown" },
              { label: "IP version", value: result.ispLocation.ipFamily },
              { label: "Masked IP", value: result.ispLocation.ipMasked },
              {
                label: "Approx. region",
                value:
                  [result.ispLocation.city, result.ispLocation.region, result.ispLocation.country]
                    .filter(Boolean)
                    .join(", ") || "not available",
                mono: false,
              },
              {
                label: "Server",
                value: `${result.server.chosen.provider}${result.server.chosen.edgeCode ? ` · ${result.server.chosen.edgeCode}` : ""}`,
                mono: false,
              },
              {
                label: "Server availability",
                value: `${Math.round(result.server.chosen.availability * 100)}%`,
                hint: "of probes answered",
              },
              { label: "Test duration", value: `${(result.durationMs / 1000).toFixed(1)} s` },
              { label: "Data transferred", value: `${result.dataUsedMB.toFixed(0)} MB` },
              { label: "Raw samples", value: String(result.samples.length) },
              { label: "Browser", value: result.preflight.browser, mono: false },
              { label: "Mode", value: result.lowData ? "Low-data" : "Full", mono: false },
            ]}
          />

          <Section
            title="Browser limitations for this run"
            description="What a web page genuinely cannot measure, stated rather than estimated."
          >
            <ul className="list-disc space-y-1.5 pl-5 text-[13.5px] leading-relaxed text-muted-foreground">
              {result.limitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </Section>

          <Section title="Methodology">
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" size="sm" onClick={onShowMethod} className="gap-1.5">
                <Download className="size-3.5" /> Methodology &amp; raw JSON
              </Button>
              {result.packetLoss.status === "experimental" && (
                <Badge variant="outline" className="text-muted-foreground">
                  packet loss: experimental UDP-reachability check
                </Badge>
              )}
            </div>
          </Section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
