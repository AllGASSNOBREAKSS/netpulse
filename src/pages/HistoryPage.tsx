import { Fragment, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  FileJson,
  FileSpreadsheet,
  GitCompareArrows,
  History as HistoryIcon,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { downloadCsv, downloadText } from "@/lib/export";
import {
  EmptyState,
  KeyValueList,
  PageHeader,
  Panel,
  Section,
  StatGrid,
  StatusPill,
  type StatusTone,
} from "@/components/np/Layout";
import { cn } from "@/lib/utils";
import type { HistoryEntry } from "@/lib/history";

export type { HistoryEntry } from "@/lib/history";

const RANGES = { "7d": 7 * 864e5, "30d": 30 * 864e5, "90d": 90 * 864e5, all: Infinity } as const;
type RangeKey = keyof typeof RANGES;

const QUALITY = { all: "Any result", good: "Healthy (score ≥ 70)", poor: "Needs attention (< 70)" } as const;
type QualityKey = keyof typeof QUALITY;

const fmt = (n: number) => (n >= 100 ? String(Math.round(n)) : n.toFixed(1));
const when = (ts: number) =>
  new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

const gradeTone = (g: string): StatusTone => (g <= "B" ? "good" : g <= "C" ? "warn" : "bad");
const scoreTone = (s: number): StatusTone => (s >= 70 ? "good" : s >= 45 ? "warn" : "bad");

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
  const [quality, setQuality] = useState<QualityKey>("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [detail, setDetail] = useState<HistoryEntry | null>(null);
  const [confirm, setConfirm] = useState<"all" | number | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);

  // localStorage is read synchronously on mount; the skeleton covers that first
  // paint rather than pretending to fetch something.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setHydrated(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const [mountedAt] = useState(() => Date.now());
  const rows = useMemo(() => {
    const cutoff = mountedAt - RANGES[range];
    const q = query.trim().toLowerCase();
    return history.filter((h) => {
      if (h.ts < cutoff) return false;
      if (quality === "good" && h.score < 70) return false;
      if (quality === "poor" && h.score >= 70) return false;
      if (!q) return true;
      return `${h.isp ?? ""} ${h.server ?? ""} ${h.grade} ${when(h.ts)}`.toLowerCase().includes(q);
    });
  }, [history, range, quality, query, mountedAt]);

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
      [...rows].reverse().map((h) => ({
        t:
          new Date(h.ts).toLocaleDateString([], { month: "short", day: "numeric" }) +
          " " +
          new Date(h.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        down: +h.down.toFixed(1),
        up: +h.up.toFixed(1),
        ping: Math.round(h.ping),
        bloat: Math.round(h.bloat),
      })),
    [rows],
  );

  const throughputConfig = {
    down: { label: "Download", color: "var(--chart-1)" },
    up: { label: "Upload", color: "var(--chart-2)" },
  } satisfies ChartConfig;

  const latencyConfig = {
    ping: { label: "Idle latency", color: "var(--chart-1)" },
    bloat: { label: "Added under load", color: "var(--chart-3)" },
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

  const togglePick = (ts: number) =>
    setPicked((prev) =>
      prev.includes(ts) ? prev.filter((t) => t !== ts) : prev.length >= 2 ? [prev[1], ts] : [...prev, ts],
    );

  const comparison = useMemo(() => {
    if (picked.length !== 2) return null;
    const [a, b] = picked.map((ts) => history.find((h) => h.ts === ts)).filter(Boolean) as HistoryEntry[];
    if (!a || !b) return null;
    return a.ts < b.ts ? { older: a, newer: b } : { older: b, newer: a };
  }, [picked, history]);

  const filtersActive = range !== "all" || quality !== "all" || query.trim() !== "";

  /* ------------------------------- Loading ------------------------------- */
  if (!hydrated) {
    return (
      <div className="space-y-8">
        <PageHeader title="Test History" description="Saved locally on this device — nothing is uploaded." />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-56 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Test History"
        description="Every completed run is saved in this browser's local storage. Nothing is uploaded, and clearing it here deletes it permanently."
        actions={
          <>
            <Button
              variant={compareMode ? "secondary" : "outline"}
              size="sm"
              onClick={() => {
                setCompareMode((v) => !v);
                setPicked([]);
              }}
              disabled={history.length < 2}
              className="gap-1.5"
            >
              <GitCompareArrows className="size-3.5" /> Compare
            </Button>
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
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirm("all")}
                className="gap-1.5 text-status-bad hover:text-status-bad"
              >
                <Trash2 className="size-3.5" /> Clear all
              </Button>
            )}
          </>
        }
      />

      {history.length === 0 ? (
        <EmptyState
          icon={HistoryIcon}
          title="No tests saved yet"
          description="Run a speed test — every completed run lands here automatically, with its own trend lines and full result detail."
        />
      ) : (
        <>
          {/* ------------------------------ Filters ------------------------ */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative min-w-0 flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search ISP, server, date…"
                className="h-9 pl-9"
                aria-label="Search history"
              />
            </div>
            <Select value={range} onValueChange={(v) => setRange(v as RangeKey)}>
              <SelectTrigger className="h-9 w-36" size="sm" aria-label="Time range">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
                <SelectItem value="90d">Last 90 days</SelectItem>
                <SelectItem value="all">All time</SelectItem>
              </SelectContent>
            </Select>
            <Select value={quality} onValueChange={(v) => setQuality(v as QualityKey)}>
              <SelectTrigger className="h-9 w-48" size="sm" aria-label="Filter by result">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(QUALITY).map(([k, label]) => (
                  <SelectItem key={k} value={k}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {filtersActive && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 gap-1.5 text-muted-foreground"
                onClick={() => {
                  setRange("all");
                  setQuality("all");
                  setQuery("");
                }}
              >
                <X className="size-3.5" /> Reset
              </Button>
            )}
          </div>

          {!rows.length ? (
            <EmptyState
              icon={Search}
              title="No tests match these filters"
              description="Widen the time range or clear the search to see saved results again."
              action={
                <Button
                  variant="outline"
                  onClick={() => {
                    setRange("all");
                    setQuality("all");
                    setQuery("");
                  }}
                >
                  Reset filters
                </Button>
              }
            />
          ) : (
            <>
              <StatGrid
                columns={3}
                stats={[
                  { label: "Tests", value: String(stats!.count) },
                  { label: "Avg download", value: `${fmt(stats!.avgDown)} Mbps` },
                  { label: "Avg upload", value: `${fmt(stats!.avgUp)} Mbps` },
                  { label: "Avg latency", value: `${Math.round(stats!.avgPing)} ms` },
                  { label: "Best download", value: `${fmt(stats!.best)} Mbps`, tone: "good" },
                  { label: "Worst download", value: `${fmt(stats!.worst)} Mbps`, tone: "warn" },
                ]}
              />

              {chartData.length >= 2 && (
                <div className="grid gap-5 xl:grid-cols-2">
                  <Section title="Throughput trend" description="Download and upload across saved tests.">
                    <Panel className="p-4 sm:p-5">
                      <ChartContainer config={throughputConfig} className="h-52 w-full">
                        <LineChart data={chartData} margin={{ left: 4, right: 12, top: 8 }}>
                          <CartesianGrid vertical={false} strokeOpacity={0.3} />
                          <XAxis dataKey="t" tickLine={false} axisLine={false} fontSize={10} minTickGap={24} />
                          <YAxis tickLine={false} axisLine={false} fontSize={11} width={44} unit=" Mb" />
                          <ChartTooltip content={<ChartTooltipContent />} />
                          <Line dataKey="down" type="monotone" stroke="var(--color-down)" strokeWidth={2} dot={false} />
                          <Line dataKey="up" type="monotone" stroke="var(--color-up)" strokeWidth={2} dot={false} />
                        </LineChart>
                      </ChartContainer>
                    </Panel>
                  </Section>

                  <Section title="Latency trend" description="Idle latency and the delay added under load.">
                    <Panel className="p-4 sm:p-5">
                      <ChartContainer config={latencyConfig} className="h-52 w-full">
                        <LineChart data={chartData} margin={{ left: 4, right: 12, top: 8 }}>
                          <CartesianGrid vertical={false} strokeOpacity={0.3} />
                          <XAxis dataKey="t" tickLine={false} axisLine={false} fontSize={10} minTickGap={24} />
                          <YAxis tickLine={false} axisLine={false} fontSize={11} width={44} unit=" ms" />
                          <ChartTooltip content={<ChartTooltipContent />} />
                          <Line dataKey="ping" type="monotone" stroke="var(--color-ping)" strokeWidth={2} dot={false} />
                          <Line dataKey="bloat" type="monotone" stroke="var(--color-bloat)" strokeWidth={2} dot={false} />
                        </LineChart>
                      </ChartContainer>
                    </Panel>
                  </Section>
                </div>
              )}

              {/* --------------------------- Comparison --------------------- */}
              {compareMode && (
                <Panel tone="accent" className="space-y-3">
                  <p className="text-[13px] font-medium">
                    {comparison
                      ? "Comparing two saved runs"
                      : `Select ${2 - picked.length} more test${picked.length === 1 ? "" : "s"} from the table below.`}
                  </p>
                  {comparison && (
                    <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
                      <KeyValueList
                        items={[
                          { k: "Older run", v: when(comparison.older.ts), mono: false },
                          { k: "Download", v: `${fmt(comparison.older.down)} Mbps` },
                          { k: "Upload", v: `${fmt(comparison.older.up)} Mbps` },
                          { k: "Idle latency", v: `${Math.round(comparison.older.ping)} ms` },
                          { k: "Score", v: String(comparison.older.score) },
                        ]}
                      />
                      <KeyValueList
                        items={[
                          { k: "Newer run", v: when(comparison.newer.ts), mono: false },
                          {
                            k: "Download",
                            v: `${fmt(comparison.newer.down)} Mbps  (${delta(comparison.newer.down, comparison.older.down)})`,
                          },
                          {
                            k: "Upload",
                            v: `${fmt(comparison.newer.up)} Mbps  (${delta(comparison.newer.up, comparison.older.up)})`,
                          },
                          {
                            k: "Idle latency",
                            v: `${Math.round(comparison.newer.ping)} ms  (${delta(comparison.newer.ping, comparison.older.ping, true)})`,
                          },
                          {
                            k: "Score",
                            v: `${comparison.newer.score}  (${delta(comparison.newer.score, comparison.older.score)})`,
                          },
                        ]}
                      />
                    </div>
                  )}
                </Panel>
              )}

              {/* ----------------------------- Table ------------------------ */}
              <Section title="Saved results" description="Select a row to expand it, or open the full result.">
                <div className="overflow-x-auto rounded-xl border border-border bg-card">
                  <table className="w-full min-w-[42rem] border-collapse text-[13px]">
                    <thead>
                      <tr className="border-b border-border text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                        {compareMode && <th className="w-10 px-4 py-3" />}
                        <th className="px-4 py-3 font-medium">When</th>
                        <th className="px-4 py-3 text-right font-medium">Score</th>
                        <th className="px-4 py-3 text-right font-medium">Down</th>
                        <th className="px-4 py-3 text-right font-medium">Up</th>
                        <th className="px-4 py-3 text-right font-medium">Ping</th>
                        <th className="px-4 py-3 text-right font-medium">Bloat</th>
                        <th className="hidden px-4 py-3 font-medium md:table-cell">ISP</th>
                        <th className="w-20 px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 100).map((h) => {
                        const open = expanded === h.ts;
                        return (
                          <Fragment key={h.ts}>
                            <tr
                              className={cn(
                                "border-b border-border/60 transition-colors last:border-b-0 hover:bg-accent/50",
                                open && "bg-accent/40",
                                picked.includes(h.ts) && "bg-primary/[0.07]",
                              )}
                            >
                              {compareMode && (
                                <td className="px-4 py-2.5">
                                  <input
                                    type="checkbox"
                                    className="size-4 accent-[var(--primary)]"
                                    checked={picked.includes(h.ts)}
                                    onChange={() => togglePick(h.ts)}
                                    aria-label={`Compare test from ${when(h.ts)}`}
                                  />
                                </td>
                              )}
                              <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">{when(h.ts)}</td>
                              <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums">
                                <StatusPill tone={scoreTone(h.score)} className="justify-end text-foreground">
                                  {h.score}
                                </StatusPill>
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono tabular-nums">{fmt(h.down)}</td>
                              <td className="px-4 py-2.5 text-right font-mono tabular-nums">{fmt(h.up)}</td>
                              <td className="px-4 py-2.5 text-right font-mono tabular-nums">{Math.round(h.ping)}ms</td>
                              <td className="px-4 py-2.5 text-right">
                                <StatusPill tone={gradeTone(h.grade)} className="justify-end">
                                  {h.grade}
                                </StatusPill>
                              </td>
                              <td className="hidden max-w-40 truncate px-4 py-2.5 text-muted-foreground md:table-cell">
                                {h.isp ?? "—"}
                              </td>
                              <td className="px-4 py-2.5">
                                <div className="flex items-center justify-end gap-0.5">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-7 text-muted-foreground"
                                    aria-label={open ? "Collapse row" : "Expand row"}
                                    aria-expanded={open}
                                    onClick={() => setExpanded(open ? null : h.ts)}
                                  >
                                    <ChevronDown
                                      className={cn("size-4 transition-transform duration-200", open && "rotate-180")}
                                    />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-7 text-muted-foreground hover:text-status-bad"
                                    aria-label={`Delete test from ${when(h.ts)}`}
                                    onClick={() => setConfirm(h.ts)}
                                  >
                                    <Trash2 className="size-3.5" />
                                  </Button>
                                </div>
                              </td>
                            </tr>
                            {open && (
                              <tr className="border-b border-border/60 bg-muted/30">
                                <td colSpan={compareMode ? 9 : 8} className="px-4 py-4 sm:px-6">
                                  <div className="grid gap-x-10 gap-y-1 sm:grid-cols-2">
                                    <KeyValueList
                                      items={[
                                        { k: "Test server", v: h.server ?? "not recorded", mono: false },
                                        { k: "ISP", v: h.isp ?? "not recorded", mono: false },
                                        { k: "Bufferbloat grade", v: h.grade },
                                      ]}
                                    />
                                    <KeyValueList
                                      items={[
                                        { k: "Added latency under load", v: `${Math.round(h.bloat)} ms` },
                                        { k: "Data transferred", v: `${Math.round(h.dataMB)} MB` },
                                        {
                                          k: "Confidence",
                                          v: h.confidence != null ? `${h.confidence}%` : "not recorded",
                                        },
                                      ]}
                                    />
                                  </div>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="mt-4"
                                    onClick={() => setDetail(h)}
                                  >
                                    Open full result
                                  </Button>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {rows.length > 100 && (
                  <p className="text-[12.5px] text-muted-foreground">
                    Showing the 100 most recent of {rows.length} matching tests. Export to CSV or JSON for the full set.
                  </p>
                )}
              </Section>
            </>
          )}
        </>
      )}

      {/* ------------------------------- Drawer -------------------------- */}
      <Sheet open={detail !== null} onOpenChange={(o) => !o && setDetail(null)}>
        <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{detail ? when(detail.ts) : "Result"}</SheetTitle>
            <SheetDescription>
              The full saved record for this run. Values are exactly as measured — nothing is
              recomputed here.
            </SheetDescription>
          </SheetHeader>
          {detail && (
            <div className="overflow-y-auto px-4 pb-6">
              <KeyValueList
                items={[
                  { k: "Internet Health", v: `${detail.score}/100` },
                  { k: "Download", v: `${fmt(detail.down)} Mbps` },
                  { k: "Upload", v: `${fmt(detail.up)} Mbps` },
                  { k: "Idle latency", v: `${Math.round(detail.ping)} ms` },
                  { k: "Added under load", v: `${Math.round(detail.bloat)} ms` },
                  { k: "Bufferbloat grade", v: detail.grade },
                  { k: "Confidence", v: detail.confidence != null ? `${detail.confidence}%` : "not recorded" },
                  { k: "Data transferred", v: `${Math.round(detail.dataMB)} MB` },
                  { k: "ISP", v: detail.isp ?? "not recorded", mono: false },
                  { k: "Test server", v: detail.server ?? "not recorded", mono: false },
                  { k: "Recorded", v: new Date(detail.ts).toLocaleString(), mono: false },
                ]}
              />
              <Button
                variant="outline"
                size="sm"
                className="mt-5 w-full gap-1.5 text-status-bad hover:text-status-bad"
                onClick={() => {
                  setConfirm(detail.ts);
                  setDetail(null);
                }}
              >
                <Trash2 className="size-3.5" /> Delete this result
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* --------------------------- Delete confirm ---------------------- */}
      <Dialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{confirm === "all" ? "Delete all saved tests?" : "Delete this test?"}</DialogTitle>
            <DialogDescription>
              {confirm === "all"
                ? `This permanently removes all ${history.length} saved results from this browser. It cannot be undone — export first if you want to keep them.`
                : "This permanently removes the saved result from this browser. It cannot be undone."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (confirm === "all") onClear();
                else if (typeof confirm === "number") onDelete(confirm);
                setConfirm(null);
                setPicked([]);
              }}
            >
              {confirm === "all" ? "Delete all" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Signed change between two measured figures. `lowerIsBetter` flips the tone. */
function delta(now: number, before: number, lowerIsBetter = false): string {
  const diff = now - before;
  if (Math.abs(diff) < 0.05) return "no change";
  const pct = before === 0 ? null : Math.round((diff / before) * 100);
  const sign = diff > 0 ? "+" : "−";
  const better = lowerIsBetter ? diff < 0 : diff > 0;
  return `${sign}${Math.abs(pct ?? 0)}% ${better ? "better" : "worse"}`;
}
