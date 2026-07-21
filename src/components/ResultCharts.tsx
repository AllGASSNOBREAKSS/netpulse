import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts";
import { useReducedMotion } from "../hooks/use-reduced-motion";
import type { Sample, TestResult } from "../lib/engine";
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

const loadedConfig = {
  current: { label: "Median latency", color: "var(--chart-1)" },
} satisfies ChartConfig;

const comparisonConfig = {
  change: { label: "Improvement", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function ResultCharts({
  result,
  previous,
  liveSamples,
  running,
}: {
  result: TestResult | null;
  previous: HistoryEntry | null;
  liveSamples: Sample[];
  running: boolean;
}) {
  const reducedMotion = useReducedMotion();
  if (!result) {
    if (liveSamples.length) return <LiveMeasurementCharts samples={liveSamples} running={running} />;
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
  const comparison = previous
    ? [
        comparisonPoint("Download", result.downloadMbps, previous.down, "Mbps", false),
        comparisonPoint("Upload", result.uploadMbps, previous.up, "Mbps", false),
        comparisonPoint("Idle latency", result.idlePingMs, previous.ping, "ms", true),
        comparisonPoint("Bufferbloat", result.bufferbloatMs, previous.bloat, "ms", true),
      ]
    : [];

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
                    <Line type="monotone" dataKey="rtt" stroke="var(--color-rtt)" strokeWidth={2.4} dot={false} isAnimationActive={!reducedMotion} animationDuration={700} animationEasing="ease-out" />
                  </LineChart>
                </ChartContainer>
              ) : <ChartUnavailable />}
            </ChartPanel>
          </TabsContent>

          <TabsContent value="throughput">
            <ChartPanel title="Download and upload throughput" note={`${throughput.length} measured windows or accepted-payload observations`}>
              {throughput.length ? (
                <ChartContainer config={throughputConfig} className="h-[280px] w-full">
                  <AreaChart data={throughput} accessibilityLayer>
                    <defs>
                      <linearGradient id="download-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--color-download)" stopOpacity={0.35} /><stop offset="100%" stopColor="var(--color-download)" stopOpacity={0.02} /></linearGradient>
                      <linearGradient id="upload-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--color-upload)" stopOpacity={0.28} /><stop offset="100%" stopColor="var(--color-upload)" stopOpacity={0.02} /></linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="second" tickLine={false} axisLine={false} unit="s" />
                    <YAxis tickLine={false} axisLine={false} unit=" Mbps" width={72} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Area type="monotone" dataKey="download" stroke="var(--color-download)" fill="url(#download-fill)" strokeWidth={2.4} dot={false} connectNulls={false} isAnimationActive={!reducedMotion} animationDuration={750} animationEasing="ease-out" />
                    <Area type="monotone" dataKey="upload" stroke="var(--color-upload)" fill="url(#upload-fill)" strokeWidth={2.4} dot={false} connectNulls={false} isAnimationActive={!reducedMotion} animationDuration={750} animationEasing="ease-out" />
                  </AreaChart>
                </ChartContainer>
              ) : <ChartUnavailable />}
            </ChartPanel>
          </TabsContent>

          <TabsContent value="loaded">
            <ChartPanel title="Idle versus loaded latency" note="Medians in milliseconds; lower is better">
              <ChartContainer config={loadedConfig} className="h-[280px] w-full">
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
                  <Bar dataKey="current" fill="var(--chart-1)" radius={6} isAnimationActive={!reducedMotion} animationDuration={650} animationEasing="ease-out" />
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
                    <Line type="linear" dataKey="rtt" stroke="var(--color-rtt)" strokeWidth={2.4} dot={false} isAnimationActive={!reducedMotion} animationDuration={700} animationEasing="ease-out" />
                  </LineChart>
                </ChartContainer>
              ) : <ChartUnavailable />}
            </ChartPanel>
          </TabsContent>

          <TabsContent value="comparison">
            <ChartPanel
              title="Previous-test comparison"
              note={previous ? `Percent improvement versus ${new Date(previous.ts).toLocaleString()}; positive is better` : "No earlier compatible result is saved"}
            >
              {previous ? (
                <ChartContainer config={comparisonConfig} className="h-[280px] w-full">
                  <BarChart data={comparison} accessibilityLayer>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="metric" tickLine={false} axisLine={false} />
                    <YAxis tickLine={false} axisLine={false} width={58} unit="%" />
                    <ReferenceLine y={0} stroke="var(--border)" />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="change" fill="var(--color-change)" radius={4} isAnimationActive={!reducedMotion} animationDuration={650} animationEasing="ease-out" />
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

function LiveMeasurementCharts({ samples, running }: { samples: Sample[]; running: boolean }) {
  const latency = samples
    .filter((sample) => sample.rttMs !== undefined)
    .map((sample) => ({ second: Number((sample.t / 1000).toFixed(1)), rtt: Number(sample.rttMs?.toFixed(1)) }));
  const throughput = samples
    .filter((sample) => sample.mbps !== undefined)
    .map((sample) => ({
      second: Number((sample.t / 1000).toFixed(1)),
      download: sample.phase.startsWith("download") ? Number(sample.mbps?.toFixed(2)) : undefined,
      upload: sample.phase === "upload" ? Number(sample.mbps?.toFixed(2)) : undefined,
    }));

  return (
    <Card className="result-section live-telemetry" aria-live="off">
      <CardHeader>
        <CardTitle>Live measurement telemetry</CardTitle>
        <CardDescription>{running ? "Updating from real timed samples as the test runs." : "The run stopped; only completed samples are retained."}</CardDescription>
      </CardHeader>
      <CardContent className="live-chart-grid">
        <ChartPanel title="Throughput now" note={`${throughput.length} measured windows or accepted-payload observations`}>
          {throughput.length ? (
            <ChartContainer config={throughputConfig} className="h-[220px] w-full">
              <AreaChart data={throughput} accessibilityLayer>
                <defs>
                  <linearGradient id="live-download-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--color-download)" stopOpacity={0.36} /><stop offset="100%" stopColor="var(--color-download)" stopOpacity={0.02} /></linearGradient>
                  <linearGradient id="live-upload-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--color-upload)" stopOpacity={0.3} /><stop offset="100%" stopColor="var(--color-upload)" stopOpacity={0.02} /></linearGradient>
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="second" tickLine={false} axisLine={false} unit="s" minTickGap={24} />
                <YAxis tickLine={false} axisLine={false} unit=" Mbps" width={70} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area type="monotone" dataKey="download" stroke="var(--color-download)" fill="url(#live-download-fill)" strokeWidth={2.5} dot={false} connectNulls={false} isAnimationActive={false} />
                <Area type="monotone" dataKey="upload" stroke="var(--color-upload)" fill="url(#live-upload-fill)" strokeWidth={2.5} dot={false} connectNulls={false} isAnimationActive={false} />
              </AreaChart>
            </ChartContainer>
          ) : <ChartUnavailable text="Waiting for the first throughput window." />}
        </ChartPanel>
        <ChartPanel title="Latency under test" note={`${latency.length} completed HTTPS latency samples`}>
          {latency.length ? (
            <ChartContainer config={latencyConfig} className="h-[220px] w-full">
              <LineChart data={latency} accessibilityLayer>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="second" tickLine={false} axisLine={false} unit="s" minTickGap={24} />
                <YAxis tickLine={false} axisLine={false} unit="ms" width={54} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Line type="linear" dataKey="rtt" stroke="var(--color-rtt)" strokeWidth={2.4} dot={false} isAnimationActive={false} />
              </LineChart>
            </ChartContainer>
          ) : <ChartUnavailable text="Waiting for the first completed latency sample." />}
        </ChartPanel>
      </CardContent>
    </Card>
  );
}

function comparisonPoint(
  metric: string,
  current: number,
  previous: number,
  unit: string,
  lowerIsBetter: boolean,
) {
  const rawChange = previous === 0 ? 0 : ((current - previous) / Math.abs(previous)) * 100;
  return {
    metric,
    change: Number((lowerIsBetter ? -rawChange : rawChange).toFixed(1)),
    current: `${formatChartValue(current)} ${unit}`,
    previous: `${formatChartValue(previous)} ${unit}`,
  };
}

function formatChartValue(value: number): string {
  return value >= 100 ? String(Math.round(value)) : value.toFixed(1);
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
