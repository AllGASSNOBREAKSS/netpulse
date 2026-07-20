import { lazy, Suspense, useCallback, useRef, useState } from "react";
import { ArrowRight, Play, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppHeader } from "@/components/AppHeader";
import { AppSidebar } from "@/components/AppSidebar";
import { NpFooter } from "@/components/Footer";
import { Gauge } from "@/components/Gauge";
import { ConnectionPrivacy, LatencyMonitor } from "@/components/Panels";
import { MetricDetail, ScoreDetail } from "@/components/MetricDetail";
import { MethodologyModal, PreflightServer } from "@/components/Report";
import { FixMyInternet } from "@/components/FixMyInternet";
import type { HistoryEntry } from "@/pages/HistoryPage";

// Chart-heavy pages load on demand so recharts stays out of the main bundle.
const ResultsPage = lazy(() => import("@/pages/Results").then((m) => ({ default: m.ResultsPage })));
const HistoryPage = lazy(() => import("@/pages/HistoryPage").then((m) => ({ default: m.HistoryPage })));
import { ConnectionDetailsPage } from "@/pages/ConnectionDetails";
import { CalculatorPage, FaqPage, GuidesPage } from "@/pages/Learn";
import { runTest, type Phase, type TestResult } from "@/lib/engine";
import { buildShareReport } from "@/lib/export";
import { METRICS } from "@/lib/metrics";
import type { Preflight, ServerSelection } from "@/lib/types";
import type { View } from "@/lib/views";
import { judge, type Verdict } from "@/lib/verdict";

const HISTORY_KEY = "netpulse_history";

function loadHistory(): HistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
  } catch {
    return [];
  }
}
function saveHistory(entries: HistoryEntry[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, 100)));
  } catch {
    /* localStorage unavailable */
  }
}

const PHASE_LABEL: Record<Phase, string> = {
  idle: "Ready when you are",
  preflight: "Inspecting connection",
  server: "Selecting best server",
  latency: "Measuring idle latency",
  download_single: "Download — single connection",
  download_multi: "Download — multi connection",
  upload: "Measuring upload",
  packetloss: "Analysis — UDP reachability",
  done: "Test complete",
  error: "Test failed — check your connection and retry",
};

export default function App() {
  const [view, setView] = useState<View>("speed");
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<TestResult | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [lowData, setLowData] = useState(false);
  const [liveDown, setLiveDown] = useState<number | null>(null);
  const [liveUp, setLiveUp] = useState<number | null>(null);
  const [openMetric, setOpenMetric] = useState<string | null>(null);
  const [showScore, setShowScore] = useState(false);
  const [showMethod, setShowMethod] = useState(false);
  const [reportCopied, setReportCopied] = useState(false);
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [server, setServer] = useState<ServerSelection | null>(null);
  const runningRef = useRef(false);

  const running = phase !== "idle" && phase !== "done" && phase !== "error";

  const copyReport = useCallback(async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(buildShareReport(result, verdict));
      setReportCopied(true);
      setTimeout(() => setReportCopied(false), 1600);
    } catch {
      setReportCopied(false);
    }
  }, [result, verdict]);

  const start = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setResult(null);
    setVerdict(null);
    setLiveDown(null);
    setLiveUp(null);
    setPreflight(null);
    setServer(null);
    setView("speed");
    try {
      const r = await runTest(
        { lowData },
        {
          onPhase: setPhase,
          onPreflight: setPreflight,
          onServer: setServer,
          onSample: (s) => {
            if (s.mbps === undefined) return;
            if (s.phase === "upload") setLiveUp(s.mbps);
            else setLiveDown(s.mbps);
          },
        },
      );
      setResult(r);
      const v = judge(r);
      setVerdict(v);
      const entry: HistoryEntry = {
        ts: r.timestamp,
        down: r.downloadMbps,
        up: r.uploadMbps,
        ping: r.idlePingMs,
        bloat: r.bufferbloatMs,
        grade: r.bufferbloatGrade,
        score: v.score,
        dataMB: r.dataUsedMB,
        isp: r.ispLocation.ispHint ?? undefined,
        server: `${r.server.chosen.provider}${r.server.chosen.edgeCode ? ` ${r.server.chosen.edgeCode}` : ""}`.trim(),
        confidence: r.confidence.score,
      };
      setHistory((prev) => {
        const next = [entry, ...prev];
        saveHistory(next);
        return next;
      });
    } catch {
      setPhase("error");
    } finally {
      runningRef.current = false;
    }
  }, [lowData]);

  const openDef = openMetric ? METRICS.find((m) => m.id === openMetric) : null;
  const isDownloadPhase = phase === "download_single" || phase === "download_multi";
  const isUploadPhase = phase === "upload";

  /* ---- Speed Test page ---- */
  const speedPage = (
    <div className="space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Speed Test</h1>
        <p className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">
          Measure performance, expose instability, and understand what affects your connection —
          every number below is measured live, never simulated.
        </p>
      </div>

      <Card className="overflow-hidden">
        <CardContent className="px-4 py-6 sm:px-8">
          <div className="grid gap-8 sm:grid-cols-2">
            <Gauge
              label="Download"
              liveMbps={liveDown}
              active={isDownloadPhase}
              waiting={running && !isDownloadPhase && !isUploadPhase}
              done={phase === "done"}
              finalMbps={result?.downloadMbps ?? null}
            />
            <Gauge
              label="Upload"
              liveMbps={liveUp}
              active={isUploadPhase}
              waiting={running && !isUploadPhase}
              done={phase === "done"}
              finalMbps={result?.uploadMbps ?? null}
            />
          </div>

          <div className="mt-5 flex flex-col items-center gap-4">
            <div className="stage__status" role="status">
              {running && <span className="pulse-dot" aria-hidden="true" />}
              {PHASE_LABEL[phase]}
            </div>

            {verdict && result && phase === "done" && (
              <button
                onClick={() => setShowScore(true)}
                className="w-full max-w-md rounded-xl border bg-accent/40 px-5 py-4 text-left transition-colors hover:border-primary/50"
                title="See how this score is calculated"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Internet Health
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    confidence {result.confidence.score}%
                  </span>
                </div>
                <div className="mt-1 flex items-baseline gap-3">
                  <span className="font-display text-4xl font-extrabold italic">
                    {verdict.score}
                    <span className="text-lg text-muted-foreground">/100</span>
                  </span>
                  <span className="text-sm text-muted-foreground">{verdict.headline}</span>
                </div>
              </button>
            )}

            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button size="lg" onClick={() => void start()} disabled={running} className="gap-2 px-8">
                <Play className="size-4" />
                {running ? "Testing…" : result ? "Run Again" : "Start Test"}
              </Button>
              {result && (
                <Button size="lg" variant="outline" onClick={() => void copyReport()} className="gap-2">
                  <Share2 className="size-4" /> {reportCopied ? "Copied ✓" : "Share Result"}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {(preflight || server) && !result && <PreflightServer preflight={preflight} server={server} preOnly />}

      {result && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                ["Download", `${result.downloadMbps >= 100 ? Math.round(result.downloadMbps) : result.downloadMbps.toFixed(1)} Mbps`, true],
                ["Upload", `${result.uploadMbps >= 100 ? Math.round(result.uploadMbps) : result.uploadMbps.toFixed(1)} Mbps`, true],
                ["Idle latency", `${Math.round(result.idlePingMs)} ms`, true],
                ["Jitter", `${result.idleJitterMs.toFixed(1)} ms`, true],
                ["Loaded latency", `${Math.round(Math.max(result.loadedDownPingMs, result.loadedUpPingMs))} ms`, true],
                ["Bufferbloat", `grade ${result.bufferbloatGrade}`, true],
                ["Test server", `${result.server.chosen.provider}${result.server.chosen.edgeCode ? ` · edge ${result.server.chosen.edgeCode}` : ""}`, false],
                ["Masked IP", result.ispLocation.ipMasked, true],
              ] as [string, string, boolean][]
            ).map(([k, v, mono]) => (
              <Card key={k} className="py-3">
                <CardContent className="px-4">
                  <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">{k}</div>
                  <div className={`mt-0.5 truncate text-sm font-semibold ${mono ? "font-mono" : ""}`} title={v}>
                    {v}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="text-center">
            <Button variant="outline" onClick={() => setView("results")} className="gap-2">
              View Complete Internet Analysis <ArrowRight className="size-4" />
            </Button>
          </div>
        </>
      )}
    </div>
  );

  return (
    <SidebarProvider>
      <AppSidebar view={view} onNavigate={setView} lowData={lowData} onLowData={setLowData} testing={running} />
      <SidebarInset className="min-w-0">
        <AppHeader />
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
          <Suspense fallback={<div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>}>
          {view === "speed" && speedPage}
          {view === "results" && (
            <ResultsPage
              result={result}
              verdict={verdict}
              running={running}
              onRunTest={() => void start()}
              onOpenMetric={setOpenMetric}
              onShowScore={() => setShowScore(true)}
              onShowMethod={() => setShowMethod(true)}
              onCopyReport={() => void copyReport()}
              reportCopied={reportCopied}
            />
          )}
          {view === "fixit" && <FixMyInternet />}
          {view === "blackbox" && <LatencyMonitor />}
          {view === "history" && (
            <HistoryPage
              history={history}
              onClear={() => {
                setHistory([]);
                saveHistory([]);
              }}
              onDelete={(ts) => {
                setHistory((prev) => {
                  const next = prev.filter((h) => h.ts !== ts);
                  saveHistory(next);
                  return next;
                });
              }}
            />
          )}
          {view === "details" && <ConnectionDetailsPage result={result} />}
          {view === "privacy" && <ConnectionPrivacy />}
          {view === "calculator" && <CalculatorPage />}
          {view === "guides" && <GuidesPage />}
          {view === "faq" && <FaqPage />}
          </Suspense>
        </main>
        <NpFooter onNavigate={setView} onMethodology={() => result && setShowMethod(true)} />
      </SidebarInset>

      {openDef && <MetricDetail def={openDef} result={result} onClose={() => setOpenMetric(null)} />}
      {showScore && verdict && (
        <ScoreDetail score={verdict.score} parts={verdict.breakdown} onClose={() => setShowScore(false)} />
      )}
      {showMethod && result && (
        <MethodologyModal result={result} verdict={verdict} onClose={() => setShowMethod(false)} />
      )}
    </SidebarProvider>
  );
}
