import { Area, AreaChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import type { Sample, TestResult } from "@/lib/engine";

/** Latency over the whole run — every point is a real timed probe. */
export function LatencyTimeline({ result }: { result: TestResult }) {
  const reducedMotion = useReducedMotion();
  const data = result.samples
    .filter((s) => s.rttMs !== undefined)
    .map((s) => ({ t: +(s.t / 1000).toFixed(1), rtt: Math.round(s.rttMs!), phase: s.phase }));
  if (data.length < 3) return null;

  const config = { rtt: { label: "Latency (ms)", color: "var(--chart-1)" } } satisfies ChartConfig;
  return (
    <ChartContainer config={config} className="h-56 w-full">
      <LineChart data={data} margin={{ left: 4, right: 12, top: 8 }}>
        <CartesianGrid vertical={false} strokeOpacity={0.35} />
        <XAxis dataKey="t" tickLine={false} axisLine={false} unit="s" fontSize={11} />
        <YAxis tickLine={false} axisLine={false} unit="ms" fontSize={11} width={52} />
        <ChartTooltip content={<ChartTooltipContent labelFormatter={(v) => `${v}s into test`} />} />
        <Line dataKey="rtt" type="monotone" stroke="var(--color-rtt)" strokeWidth={2.4} dot={false} isAnimationActive={!reducedMotion} animationDuration={700} animationEasing="ease-out" />
      </LineChart>
    </ChartContainer>
  );
}

/** Throughput samples for one direction — 250 ms windows, measured. */
export function ThroughputChart({ result, dir }: { result: TestResult; dir: "download" | "upload" }) {
  const reducedMotion = useReducedMotion();
  const phases = dir === "download" ? ["download_single", "download_multi"] : ["upload"];
  const data = result.samples
    .filter((s) => s.mbps !== undefined && phases.includes(s.phase))
    .map((s) => ({ t: +(s.t / 1000).toFixed(1), mbps: +s.mbps!.toFixed(1), mode: s.streamMode ?? "" }));
  if (data.length < 3) return null;

  const config = { mbps: { label: "Mbps", color: "var(--chart-1)" } } satisfies ChartConfig;
  return (
    <ChartContainer config={config} className="h-52 w-full">
      <AreaChart data={data} margin={{ left: 4, right: 12, top: 8 }}>
        <defs>
          <linearGradient id={`tp-${dir}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-mbps)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--color-mbps)" stopOpacity={0.03} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeOpacity={0.35} />
        <XAxis dataKey="t" tickLine={false} axisLine={false} unit="s" fontSize={11} />
        <YAxis tickLine={false} axisLine={false} fontSize={11} width={44} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(v) => `${v}s into test`}
              formatter={(value, _n, item) => (
                <span className="font-mono text-xs">
                  {value} Mbps{item?.payload?.mode ? ` · ${item.payload.mode}` : ""}
                </span>
              )}
            />
          }
        />
        <Area dataKey="mbps" type="monotone" stroke="var(--color-mbps)" strokeWidth={2.4} fill={`url(#tp-${dir})`} isAnimationActive={!reducedMotion} animationDuration={750} animationEasing="ease-out" />
      </AreaChart>
    </ChartContainer>
  );
}

export function LiveMeasurementCharts({ samples }: { samples: Sample[] }) {
  const reducedMotion = useReducedMotion();
  const throughput = samples
    .filter((sample) => sample.mbps !== undefined)
    .map((sample) => ({
      t: +(sample.t / 1000).toFixed(1),
      mbps: +sample.mbps!.toFixed(1),
      phase: sample.phase.startsWith("upload") ? "Upload" : "Download",
    }));
  const latency = samples
    .filter((sample) => sample.rttMs !== undefined)
    .map((sample) => ({
      t: +(sample.t / 1000).toFixed(1),
      rtt: +sample.rttMs!.toFixed(1),
      phase: sample.phase,
    }));

  if (throughput.length === 0 && latency.length < 2) return null;

  const throughputConfig = { mbps: { label: "Measured Mbps", color: "var(--chart-1)" } } satisfies ChartConfig;
  const latencyConfig = { rtt: { label: "Measured latency", color: "var(--chart-3)" } } satisfies ChartConfig;

  return (
    <section className="grid gap-4 rounded-2xl border border-border bg-card p-5 lg:grid-cols-2" aria-label="Live measurement telemetry">
      <div className="min-w-0">
        <h2 className="font-display text-base font-semibold">Live throughput</h2>
        <p className="mb-3 text-xs text-muted-foreground">{throughput.length} real timed windows or accepted-payload observations</p>
        {throughput.length > 1 ? (
          <ChartContainer config={throughputConfig} className="h-48 w-full">
            <AreaChart data={throughput} margin={{ left: 4, right: 12, top: 8 }}>
              <defs>
                <linearGradient id="live-throughput" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-mbps)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--color-mbps)" stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeOpacity={0.3} />
              <XAxis dataKey="t" tickLine={false} axisLine={false} unit="s" fontSize={11} />
              <YAxis tickLine={false} axisLine={false} fontSize={11} width={44} />
              <ChartTooltip content={<ChartTooltipContent labelFormatter={(value) => `${value}s into test`} />} />
              <Area
                dataKey="mbps"
                type="monotone"
                stroke="var(--color-mbps)"
                strokeWidth={2.4}
                fill="url(#live-throughput)"
                isAnimationActive={!reducedMotion}
                animationDuration={220}
                animationEasing="linear"
              />
            </AreaChart>
          </ChartContainer>
        ) : <p className="flex h-48 items-center justify-center text-sm text-muted-foreground">Waiting for another throughput observation.</p>}
      </div>

      <div className="min-w-0">
        <h2 className="font-display text-base font-semibold">Latency under test</h2>
        <p className="mb-3 text-xs text-muted-foreground">{latency.length} completed HTTPS latency samples</p>
        {latency.length > 1 ? (
          <ChartContainer config={latencyConfig} className="h-48 w-full">
            <LineChart data={latency} margin={{ left: 4, right: 12, top: 8 }}>
              <CartesianGrid vertical={false} strokeOpacity={0.3} />
              <XAxis dataKey="t" tickLine={false} axisLine={false} unit="s" fontSize={11} />
              <YAxis tickLine={false} axisLine={false} unit="ms" fontSize={11} width={52} />
              <ChartTooltip content={<ChartTooltipContent labelFormatter={(value) => `${value}s into test`} />} />
              <Line
                dataKey="rtt"
                type="monotone"
                stroke="var(--color-rtt)"
                strokeWidth={2.4}
                dot={false}
                isAnimationActive={!reducedMotion}
                animationDuration={220}
                animationEasing="linear"
              />
            </LineChart>
          </ChartContainer>
        ) : <p className="flex h-48 items-center justify-center text-sm text-muted-foreground">Waiting for another latency sample.</p>}
      </div>
    </section>
  );
}
