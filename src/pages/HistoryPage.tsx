import { useMemo, useState } from "react";
import { FileJson, FileSpreadsheet, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { downloadCsv, downloadText } from "@/lib/export";

export type HistoryEntry = {
  ts: number;
  down: number;
  up: number;
  ping: number;
  bloat: number;
  grade: string;
  score: number;
  dataMB: number;
  isp?: string;
  server?: string;
  confidence?: number;
};

const RANGES = { "7d": 7 * 864e5, "30d": 30 * 864e5, all: Infinity } as const;
type RangeKey = keyof typeof RANGES;

const fmt = (n: number) => (n >= 100 ? String(Math.round(n)) : n.toFixed(1));

export function HistoryPage({
  history,
  onClear,
  onDelete,
}: {
  history: HistoryEntry[];
  onClear: () => void;
  onDelete: (ts: number) => void;
}) {
  const [range, setRange] = useState<RangeKey>("all");

  const [mountedAt] = useState(() => Date.now());
  const rows = useMemo(() => {
    const cutoff = mountedAt - RANGES[range];
    return history.filter((h) => h.ts >= cutoff);
  }, [history, range, mountedAt]);

  const stats = useMemo(() => {
    if (!rows.length) return null;
    const avg = (f: (h: HistoryEntry) => number) => rows.reduce((s, h) => s + f(h), 0) / rows.length;
    return {
      count: rows.length,
      avgDown: avg((h) => h.down),
      avgUp: avg((h) => h.up),
      avgPing: avg((h) => h.ping),
      best: Math.max(...rows.map((h) => h.down)),
      worst: Math.min(...rows.map((h) => h.down)),
    };
  }, [rows]);

  const chartData = useMemo(
    () =>
      [...rows]
        .reverse()
        .map((h) => ({
          t: new Date(h.ts).toLocaleDateString([], { month: "short", day: "numeric" }) +
            " " + new Date(h.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          down: +h.down.toFixed(1),
          up: +h.up.toFixed(1),
        })),
    [rows],
  );

  const chartConfig = {
    down: { label: "Download", color: "var(--chart-1)" },
    up: { label: "Upload", color: "var(--chart-2)" },
  } satisfies ChartConfig;

  const exportCsv = () =>
    downloadCsv(
      "netpulse-history.csv",
      rows.map((h) => ({
        timestamp: new Date(h.ts).toISOString(),
        score: h.score,
        download_mbps: h.down.toFixed(1),
        upload_mbps: h.up.toFixed(1),
        ping_ms: Math.round(h.ping),
        bufferbloat_grade: h.grade,
        data_mb: Math.round(h.dataMB),
        isp: h.isp ?? "",
        server: h.server ?? "",
        confidence: h.confidence ?? "",
      })),
    );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold italic">Test History</h1>
          <p className="text-sm text-muted-foreground">Saved locally on this device — nothing is uploaded.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={range} onValueChange={(v) => setRange(v as RangeKey)}>
            <SelectTrigger className="w-32" size="sm" aria-label="Time range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="all">All time</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length} className="gap-1.5">
            <FileSpreadsheet className="size-3.5" /> CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!rows.length}
            onClick={() => downloadText("netpulse-history.json", JSON.stringify(rows, null, 2), "application/json")}
            className="gap-1.5"
          >
            <FileJson className="size-3.5" /> JSON
          </Button>
          {history.length > 0 && (
            <Button variant="outline" size="sm" onClick={onClear} className="gap-1.5 text-status-bad hover:text-status-bad">
              <Trash2 className="size-3.5" /> Clear all
            </Button>
          )}
        </div>
      </div>

      {!rows.length ? (
        <Card>
          <CardHeader className="items-center text-center">
            <CardTitle className="text-base">No tests {range !== "all" ? "in this range" : "yet"}</CardTitle>
            <CardDescription>Run a speed test — every completed run lands here automatically.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ["Tests", String(stats!.count)],
              ["Avg download", `${fmt(stats!.avgDown)} Mbps`],
              ["Avg upload", `${fmt(stats!.avgUp)} Mbps`],
              ["Avg ping", `${Math.round(stats!.avgPing)} ms`],
              ["Best download", `${fmt(stats!.best)} Mbps`],
              ["Worst download", `${fmt(stats!.worst)} Mbps`],
            ].map(([k, v]) => (
              <Card key={k} className="py-3">
                <CardContent className="px-4">
                  <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">{k}</div>
                  <div className="mt-0.5 font-mono text-lg font-bold">{v}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          {chartData.length >= 2 && (
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-base">Throughput trend</CardTitle>
                <CardDescription>Download and upload across saved tests</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer config={chartConfig} className="h-52 w-full">
                  <LineChart data={chartData} margin={{ left: 4, right: 12, top: 8 }}>
                    <CartesianGrid vertical={false} strokeOpacity={0.35} />
                    <XAxis dataKey="t" tickLine={false} axisLine={false} fontSize={10} />
                    <YAxis tickLine={false} axisLine={false} fontSize={11} width={44} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Line dataKey="down" type="monotone" stroke="var(--color-down)" strokeWidth={2} dot />
                    <Line dataKey="up" type="monotone" stroke="var(--color-up)" strokeWidth={2} dot />
                  </LineChart>
                </ChartContainer>
              </CardContent>
            </Card>
          )}

          <Card className="py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                  <TableHead className="text-right">Download</TableHead>
                  <TableHead className="text-right">Upload</TableHead>
                  <TableHead className="text-right">Ping</TableHead>
                  <TableHead className="text-right">Bloat</TableHead>
                  <TableHead className="hidden md:table-cell">ISP</TableHead>
                  <TableHead className="hidden lg:table-cell">Server</TableHead>
                  <TableHead className="text-right">Conf.</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.slice(0, 50).map((h) => (
                  <TableRow key={h.ts}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {new Date(h.ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold">{h.score}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(h.down)}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(h.up)}</TableCell>
                    <TableCell className="text-right font-mono">{Math.round(h.ping)}ms</TableCell>
                    <TableCell className="text-right">
                      <Badge variant={h.grade <= "B" ? "secondary" : "destructive"} className="font-mono">
                        {h.grade}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden max-w-36 truncate text-muted-foreground md:table-cell">{h.isp ?? "—"}</TableCell>
                    <TableCell className="hidden text-muted-foreground lg:table-cell">{h.server ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {h.confidence != null ? `${h.confidence}%` : "—"}
                    </TableCell>
                    <TableCell className="w-8">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-muted-foreground hover:text-status-bad"
                        aria-label="Delete this entry"
                        onClick={() => onDelete(h.ts)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}
