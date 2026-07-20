import { Area, AreaChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { TestResult } from "@/lib/engine";

/** Latency over the whole run — every point is a real timed probe. */
export function LatencyTimeline({ result }: { result: TestResult }) {
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
        <Line dataKey="rtt" type="monotone" stroke="var(--color-rtt)" strokeWidth={2} dot={false} isAnimationActive />
      </LineChart>
    </ChartContainer>
  );
}

/** Throughput samples for one direction — 250 ms windows, measured. */
export function ThroughputChart({ result, dir }: { result: TestResult; dir: "download" | "upload" }) {
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
        <Area dataKey="mbps" type="monotone" stroke="var(--color-mbps)" strokeWidth={2} fill={`url(#tp-${dir})`} isAnimationActive />
      </AreaChart>
    </ChartContainer>
  );
}
