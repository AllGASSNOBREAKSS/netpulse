import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import type { TestResult } from "../lib/engine";
import type { HistoryEntry } from "../lib/history";
import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "./ui/chart";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

const latencyConfig = {
  rtt: { label: "Latency", color: "var(--chart-1)" },
} satisfies ChartConfig;

const throughputConfig = {
  download: { label: "Download", color: "var(--chart-1)" },
  upload: { label: "Upload", color: "var(--chart-2)" },
} satisfies ChartConfig;

const comparisonConfig = {
  current: { label: "Current", color: "var(--chart-1)" },
  previous: { label: "Previous", color: "var(--chart-3)" },
} satisfies ChartConfig;

export function ResultCharts({
  result,
  previous,
}: {
  result: TestResult | null;
  previous: HistoryEntry | null;
}) {
  if (!result) {
    return (
      <Card className="result-section">
        <CardHeader>
          <CardTitle>Interactive measurement charts</CardTitle>
          <CardDescription>Run a test to chart real throughput and latency samples.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="chart-empty">No decorative demo series are shown.</div>
        </CardContent>
      </Card>
    );
  }

  const latency = result.samples
    .filter((sample) => sample.rttMs !== undefined)
    .map((sample) => ({
      second: Number((sample.t / 1000).toFixed(1)),
      rtt: Number(sample.rttMs?.toFixed(1)),
      phase: sample.phase,
    }));

  const throughput = result.samples
    .filter((sample) => sample.mbps !== undefined)
    .map((sample) => ({
      second: Number((sample.t / 1000).toFixed(1)),
      download: sample.phase.startsWith("download") ? Number(sample.mbps?.toFixed(2)) : undefined,
      upload: sample.phase === "upload" ? Number(sample.mbps?.toFixed(2)) : undefined,
    }));

  const loaded = latency.filter((sample) => sample.phase.startsWith("download") || sample.phase === "upload");
  const spikeThreshold = Math.max(result.idlePingMs * 3, result.idlePingMs + 150);
  const comparison = [
    { metric: "Download", current: result.downloadMbps, previous: previous?.down },
    { metric: "Upload", current: result.uploadMbps, previous: previous?.up },
    { metric: "Idle latency", current: result.idlePingMs, previous: previous?.ping },
    { metric: "Bufferbloat", current: result.bufferbloatMs, previous: previous?.bloat },
  ];

  return (
    <Card className="result-section">
      <CardHeader>
        <CardTitle>Interactive measurement charts</CardTitle>
        <CardDescription>Every point below comes from this run or a locally saved result.</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="latency">
          <TabsList className="chart-tabs">
            <TabsTrigger value="latency">Latency</TabsTrigger>
            <TabsTrigger value="throughput">Throughput</TabsTrigger>
            <TabsTrigger value="loaded">Idle vs loaded</TabsTrigger>
            <TabsTrigger value="stability">Stability</TabsTrigger>
            <TabsTrigger value="comparison">Previous test</TabsTrigger>
          </TabsList>

          <TabsContent value="latency">
            <ChartPanel
              title="Latency timeline"
              note={latency.length ? `${latency.length} timed HTTPS samples` : "No latency samples completed"}
            >
              {latency.length ? (
                <ChartContainer config={latencyConfig} className="h-[280px] w-full">
                  <LineChart data={latency} accessibilityLayer>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="second" tickLine={false} axisLine={false} unit="s" />
                    <YAxis tickLine={false} axisLine={false} unit="ms" width={54} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Line type="monotone" dataKey="rtt" stroke="var(--color-rtt)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ChartContainer>
              ) : <ChartUnavailable />}
            </ChartPanel>
          </TabsContent>

          <TabsContent value="throughput">
            <ChartPanel title="Download and upload throughput" note={`${throughput.length} measured windows or accepted-payload observations`}>
              {throughput.length ? (
                <ChartContainer config={throughputConfig} className="h-[280px] w-full">
                  <LineChart data={throughput} accessibilityLayer>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="second" tickLine={false} axisLine={false} unit="s" />
                    <YAxis tickLine={false} axisLine={false} unit=" Mbps" width={72} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Line type="monotone" dataKey="download" stroke="var(--color-download)" strokeWidth={2} dot={false} connectNulls={false} />
                    <Line type="monotone" dataKey="upload" stroke="var(--color-upload)" strokeWidth={2} dot={false} connectNulls={false} />
                  </LineChart>
                </ChartContainer>
              ) : <ChartUnavailable />}
            </ChartPanel>
          </TabsContent>

          <TabsContent value="loaded">
            <ChartPanel title="Idle versus loaded latency" note="Medians in milliseconds; lower is better">
              <ChartContainer config={throughputConfig} className="h-[280px] w-full">
                <BarChart
                  data={[
                    { state: "Idle", current: result.idlePingMs },
                    { state: "Download load", current: result.loadedDownPingMs },
                    { state: "Upload load", current: result.loadedUpPingMs },
                  ]}
                  accessibilityLayer
                >
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="state" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} unit="ms" width={56} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="current" fill="var(--chart-1)" radius={6} />
                </BarChart>
              </ChartContainer>
            </ChartPanel>
          </TabsContent>

          <TabsContent value="stability">
            <ChartPanel
              title="Loaded-latency stability"
              note={`Spike threshold ${Math.round(spikeThreshold)} ms · ${result.stability.spikes} detected`}
            >
              {loaded.length ? (
                <ChartContainer config={latencyConfig} className="h-[280px] w-full">
                  <LineChart data={loaded} accessibilityLayer>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="second" tickLine={false} axisLine={false} unit="s" />
                    <YAxis tickLine={false} axisLine={false} unit="ms" width={56} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <ReferenceLine y={spikeThreshold} stroke="var(--warning)" strokeDasharray="4 4" />
                    <Line type="linear" dataKey="rtt" stroke="var(--color-rtt)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ChartContainer>
              ) : <ChartUnavailable />}
            </ChartPanel>
          </TabsContent>

          <TabsContent value="comparison">
            <ChartPanel
              title="Previous-test comparison"
              note={previous ? `Compared with ${new Date(previous.ts).toLocaleString()}` : "No earlier compatible result is saved"}
            >
              {previous ? (
                <ChartContainer config={comparisonConfig} className="h-[280px] w-full">
                  <BarChart data={comparison} accessibilityLayer>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="metric" tickLine={false} axisLine={false} />
                    <YAxis tickLine={false} axisLine={false} width={50} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="current" fill="var(--color-current)" radius={4} />
                    <Bar dataKey="previous" fill="var(--color-previous)" radius={4} />
                  </BarChart>
                </ChartContainer>
              ) : <ChartUnavailable text="Run and save another test to unlock a real comparison." />}
            </ChartPanel>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function ChartPanel({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <section className="chart-panel" aria-label={title}>
      <div className="chart-panel__head">
        <h3>{title}</h3>
        <p>{note}</p>
      </div>
      {children}
    </section>
  );
}

function ChartUnavailable({ text = "Measurement unavailable for this run." }: { text?: string }) {
  return <div className="chart-empty">{text}</div>;
}
