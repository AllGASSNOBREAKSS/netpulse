import { lazy, Suspense, useCallback, useRef, useState } from "react";
import { ArrowRight, Play, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { PageHeader, Section, StatGrid } from "@/components/np/Layout";
import { AppHeader } from "@/components/AppHeader";
import { AppSidebar } from "@/components/AppSidebar";
import { NpFooter } from "@/components/Footer";
import { Gauge } from "@/components/Gauge";
import { ConnectionPrivacy } from "@/components/Panels";
import { MetricDetail, ScoreDetail } from "@/components/MetricDetail";
import { MethodologyModal, PreflightServer } from "@/components/Report";
import { FixMyInternet } from "@/components/FixMyInternet";
import { loadHistory, saveHistory, type HistoryEntry } from "@/lib/history";
import { useGaugeMotion } from "@/hooks/use-gauge-motion";

// Chart-heavy pages load on demand so recharts stays out of the main bundle.
const ResultsPage = lazy(() => import("@/pages/Results").then((m) => ({ default: m.ResultsPage })));
const HistoryPage = lazy(() => import("@/pages/HistoryPage").then((m) => ({ default: m.HistoryPage })));
const LiveMeasurementCharts = lazy(() => import("@/components/ResultCharts").then((m) => ({ default: m.LiveMeasurementCharts })));
const ConnectionBlackBox = lazy(() => import("@/components/ConnectionBlackBox").then((m) => ({ default: m.ConnectionBlackBox })));
const AreaPulse = lazy(() => import("@/components/AreaPulse").then((m) => ({ default: m.AreaPulse })));
const PlanRealityCheck = lazy(() => import("@/components/PlanRealityCheck").then((m) => ({ default: m.PlanRealityCheck })));
import { ConnectionDetailsPage } from "@/pages/ConnectionDetails";
import { CalculatorPage, FaqPage, GuidesPage } from "@/pages/Learn";
import { UpcomingPage } from "@/pages/Upcoming";
import { runTest, type Phase, type Sample, type TestResult } from "@/lib/engine";
import { buildShareReport } from "@/lib/export";
import { METRICS } from "@/lib/metrics";
import type { Preflight, ServerSelection } from "@/lib/types";
import type { View } from "@/lib/views";
import { judge, type Verdict } from "@/lib/verdict";

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
  const [liveSamples, setLiveSamples] = useState<Sample[]>([]);
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
    setLiveSamples([]);
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
            setLiveSamples((samples) => [...samples.slice(-239), s]);
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
        loadedDownMs: r.loadedDownPingMs,
        loadedUpMs: r.loadedUpPingMs,
        jitterMs: r.idleJitterMs,
        stabilityScore: r.stability.score,
        durationMs: r.durationMs,
        connectionMedium: "unknown",
        timezoneOffsetMinutes: new Date(r.timestamp).getTimezoneOffset(),
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
  const gaugeValues = useGaugeMotion({
    download: phase === "done" && result ? result.downloadMbps : liveDown ?? 0,
    upload: phase === "done" && result ? result.uploadMbps : liveUp ?? 0,
  });

  /* ---- Speed Test page ---- */
  const fmtMbps = (n: number) => (n >= 100 ? String(Math.round(n)) : n.toFixed(1));
  const approxArea = result
    ? [result.ispLocation.city, result.ispLocation.region, result.ispLocation.country]
        .filter(Boolean)
        .join(", ") || "not available"
    : "";

  const speedPage = (
    <div className="space-y-10">
      <PageHeader
        className="justify-center text-center [&>div]:mx-auto [&>div]:text-center"
        title="Speed Test"
        description="Throughput, latency under load, jitter and bufferbloat — measured live in this browser, never simulated."
      />

      {/* The measurement stage: one surface, twin gauges, one primary action. */}
      <section className="px-0 py-4 sm:py-6">
        <div className="mx-auto grid max-w-4xl grid-cols-1 gap-10 sm:grid-cols-2 sm:gap-8">
          <Gauge
            label="Download"
            valueMbps={gaugeValues.download}
            active={isDownloadPhase}
            done={phase === "done"}
            hasMeasured={liveDown !== null || (phase === "done" && result !== null)}
            finalMbps={result?.downloadMbps ?? null}
          />
          <Gauge
            label="Upload"
            valueMbps={gaugeValues.upload}
            active={isUploadPhase}
            done={phase === "done"}
            hasMeasured={liveUp !== null || (phase === "done" && result !== null)}
            finalMbps={result?.uploadMbps ?? null}
          />
        </div>

        <div className="mt-8 flex flex-col items-center gap-6">
          <p
            className="flex items-center gap-2 font-mono text-[12px] text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            {running && <span className="pulse-dot" aria-hidden="true" />}
            {PHASE_LABEL[phase]}
          </p>

          <div className="flex flex-wrap items-center justify-center gap-2.5">
            <Button
              size="lg"
              onClick={() => void start()}
              disabled={running}
              className="h-11 gap-2 px-8 text-[14px] transition-transform active:scale-[0.98]"
            >
              <Play className="size-4" />
              {running ? "Testing…" : result ? "Run Again" : "Start Test"}
            </Button>
            {result && (
              <Button
                size="lg"
                variant="outline"
                onClick={() => void copyReport()}
                className="h-11 gap-2 text-[14px] transition-transform active:scale-[0.98]"
              >
                <Share2 className="size-4" /> {reportCopied ? "Copied ✓" : "Share Result"}
              </Button>
            )}
          </div>
        </div>
      </section>

      {running && liveSamples.length > 0 && (
        <Suspense fallback={<div className="h-56 animate-pulse rounded-2xl border border-border bg-card" />}>
          <LiveMeasurementCharts samples={liveSamples} />
        </Suspense>
      )}

      {/* Internet Health — the headline verdict, not a metric among metrics. */}
      {verdict && result && phase === "done" && (
        <button
          onClick={() => setShowScore(true)}
          className="group flex w-full flex-wrap items-center gap-x-8 gap-y-4 rounded-2xl border border-border bg-card px-6 py-6 text-left transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/40 sm:px-8"
          title="See how this score is calculated"
        >
          <span className="flex items-baseline gap-2">
            <span className="font-display text-[52px] font-bold leading-none tracking-tight tabular-nums">
              {verdict.score}
            </span>
            <span className="text-lg text-muted-foreground">/100</span>
          </span>
          <span className="min-w-0 flex-1 space-y-1">
            <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Internet Health
            </span>
            <span className="block text-[15px] font-medium">{verdict.headline}</span>
            <span className="block text-[12.5px] text-muted-foreground">
              Confidence {result.confidence.score}% · how this score is calculated
            </span>
          </span>
          <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5" />
        </button>
      )}

      {(preflight || server) && !result && <PreflightServer preflight={preflight} server={server} preOnly />}

      {result && (
        <>
          <Section
            title="Connection summary"
            description="The essentials from this run. Full detail, charts and raw samples live in Complete Analysis."
          >
            <StatGrid
              columns={4}
              stats={[
                { label: "Download", value: `${fmtMbps(result.downloadMbps)} Mbps` },
                { label: "Upload", value: `${fmtMbps(result.uploadMbps)} Mbps` },
                { label: "Idle latency", value: `${Math.round(result.idlePingMs)} ms` },
                {
                  label: "Bufferbloat",
                  value: `Grade ${result.bufferbloatGrade}`,
                  tone: result.bufferbloatGrade <= "B" ? "good" : result.bufferbloatGrade <= "C" ? "warn" : "bad",
                },
                { label: "ISP", value: result.ispLocation.ispHint ?? "not identified", mono: false },
                { label: "Masked IP", value: result.ispLocation.ipMasked },
                { label: "Approx. area", value: approxArea, mono: false },
                {
                  label: "Test server",
                  value: `${result.server.chosen.provider}${result.server.chosen.edgeCode ? ` · ${result.server.chosen.edgeCode}` : ""}`,
                  mono: false,
                },
              ]}
            />
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              Location is derived from your IP's routing region — it describes the network, not your
              address. The IP is masked here and is never included in exports or shared reports.
            </p>
          </Section>

          <div className="flex justify-center">
            <Button
              size="lg"
              onClick={() => setView("results")}
              className="h-11 gap-2 px-7 text-[14px] transition-transform active:scale-[0.98]"
            >
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
        {/* Right-side noise-gradient backdrop for the whole workspace. Fixed,
            behind content (z-0); page content sits above via z-10. */}
        <div className="site-noise" aria-hidden="true" />
        <AppHeader />
        <main id="main" className="np-container relative z-10 flex-1 py-10 sm:py-12">
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
          {view === "blackbox" && <ConnectionBlackBox />}
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
          {view === "areapulse" && <AreaPulse result={result} />}
          {view === "planreality" && (
            <PlanRealityCheck
              history={history}
              onHistoryChange={(next) => {
                setHistory(next);
                saveHistory(next);
              }}
            />
          )}
          {view === "reports" && (
            <UpcomingPage page={view} onNavigate={setView} />
          )}
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
