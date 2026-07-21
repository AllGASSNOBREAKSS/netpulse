import { lazy, Suspense, useCallback, useRef, useState } from "react";
import { AppShell, type AppView } from "./components/AppShell";
import { MetricDetail, ScoreDetail } from "./components/MetricDetail";
import { ConnectionPrivacy } from "./components/Panels";
import { MethodologyModal, PreflightServer } from "./components/Report";
import {
  ConnectionIdentity,
  DiagnosisPanel,
  HeroTestPanel,
  HistoryView,
  ImpactPanel,
  MetricGrid,
  NetPulseFooter,
  RawDataPanel,
} from "./components/SpeedTestSections";
import { Card, CardContent } from "./components/ui/card";
import { Skeleton } from "./components/ui/skeleton";
import { runTest, type Phase, type Sample, type TestResult } from "./lib/engine";
import { loadHistory, saveHistory, type HistoryEntry } from "./lib/history";
import { METRICS } from "./lib/metrics";
import type { Preflight, ServerSelection } from "./lib/types";
import { judge, type Verdict } from "./lib/verdict";

const ResultCharts = lazy(() => import("./components/ResultCharts").then((module) => ({ default: module.ResultCharts })));
const FixMyInternet = lazy(() => import("./components/FixMyInternet").then((module) => ({ default: module.FixMyInternet })));
const ConnectionBlackBox = lazy(() => import("./components/ConnectionBlackBox").then((module) => ({ default: module.ConnectionBlackBox })));
const AreaPulse = lazy(() => import("./components/AreaPulse").then((module) => ({ default: module.AreaPulse })));
const PlanRealityCheck = lazy(() => import("./components/PlanRealityCheck").then((module) => ({ default: module.PlanRealityCheck })));

const PHASE_LABEL: Record<Phase, string> = {
  idle: "Ready when you are",
  preflight: "Inspecting connection",
  server: "Selecting the best available server",
  latency: "Probing idle latency",
  download_single: "Download — single connection",
  download_multi: "Download — multiple connections",
  upload: "Measuring upload",
  packetloss: "Checking experimental UDP reachability",
  done: "Test complete",
  error: "Test failed — check your connection and retry",
};

export default function App() {
  const [view, setView] = useState<AppView>(() => typeof location !== "undefined" && location.hash.startsWith("#blackbox=") ? "blackbox" : "speed");
  const [phase, setPhase] = useState<Phase>("idle");
  const [live, setLive] = useState<Partial<TestResult>>({});
  const [result, setResult] = useState<TestResult | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [lowData, setLowData] = useState(false);
  const [liveMbps, setLiveMbps] = useState<number | null>(null);
  const [liveSamples, setLiveSamples] = useState<Sample[]>([]);
  const [dataMB, setDataMB] = useState(0);
  const [openMetric, setOpenMetric] = useState<string | null>(null);
  const [showScore, setShowScore] = useState(false);
  const [showMethod, setShowMethod] = useState(false);
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [server, setServer] = useState<ServerSelection | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const runningRef = useRef(false);
  const dataRef = useRef(0);

  const running = phase !== "idle" && phase !== "done" && phase !== "error";

  const recordHistory = useCallback((measured: TestResult) => {
    const measuredVerdict = judge(measured);
    const entry: HistoryEntry = {
      ts: measured.timestamp,
      down: measured.downloadMbps,
      up: measured.uploadMbps,
      ping: measured.idlePingMs,
      bloat: measured.bufferbloatMs,
      grade: measured.bufferbloatGrade,
      score: measuredVerdict.score,
      dataMB: measured.dataUsedMB,
      confidence: measured.confidence.score,
      loadedDownMs: measured.loadedDownPingMs,
      loadedUpMs: measured.loadedUpPingMs,
      jitterMs: measured.idleJitterMs,
      stabilityScore: measured.stability.score,
      durationMs: measured.durationMs,
      connectionMedium: "unknown",
      timezoneOffsetMinutes: new Date(measured.timestamp).getTimezoneOffset(),
    };
    setHistory((previous) => {
      const next = [entry, ...previous];
      saveHistory(next);
      return next;
    });
    return measuredVerdict;
  }, []);

  const start = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setLive({});
    setResult(null);
    setVerdict(null);
    setLiveMbps(null);
    setLiveSamples([]);
    setPreflight(null);
    setServer(null);
    setErrorMessage(null);
    setShareStatus(null);
    dataRef.current = 0;
    setDataMB(0);

    try {
      const measured = await runTest(
        { lowData },
        {
          onPhase: setPhase,
          onPreflight: setPreflight,
          onServer: setServer,
          onSample: (sample) => {
            setLiveSamples((samples) => [...samples.slice(-239), sample]);
            if (sample.mbps !== undefined) {
              setLiveMbps(sample.mbps);
            }
          },
          onBytes: (bytes) => {
            dataRef.current = bytes / 1_000_000;
            setDataMB(dataRef.current);
          },
          onPartial: (partial) => setLive((previous) => ({ ...previous, ...partial })),
        },
      );

      setResult(measured);
      setLiveMbps(measured.downloadMbps);
      setDataMB(measured.dataUsedMB);
      const nextVerdict = recordHistory(measured);
      setVerdict(nextVerdict);
    } catch (error) {
      console.error("NetPulse measurement failed.", error);
      setErrorMessage(toRunErrorMessage(error));
      setPhase("error");
    } finally {
      runningRef.current = false;
    }
  }, [lowData, recordHistory]);

  const shareResult = useCallback(async () => {
    if (!result || !verdict) return;
    const text = `NetPulse result: ${verdict.score}/100 health · ${formatSpeed(result.downloadMbps)} Mbps down · ${formatSpeed(result.uploadMbps)} Mbps up · ${Math.round(result.idlePingMs)} ms idle latency · bufferbloat ${result.bufferbloatGrade}.`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "NetPulse connection result", text });
        setShareStatus("Shared a privacy-safe summary.");
      } else {
        await navigator.clipboard.writeText(text);
        setShareStatus("Privacy-safe summary copied.");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setShareStatus("Share canceled.");
      } else {
        console.warn("NetPulse could not share this result.", error);
        setShareStatus("Sharing is unavailable in this browser.");
      }
    }
  }, [result, verdict]);

  const openDef = openMetric ? METRICS.find((metric) => metric.id === openMetric) : null;
  const previous = result ? history.find((entry) => entry.ts !== result.timestamp) ?? null : history[0] ?? null;
  const status = phase === "error" && errorMessage ? errorMessage : PHASE_LABEL[phase];

  return (
    <AppShell view={view} onViewChange={setView} lowData={lowData} onLowDataChange={setLowData}>
      {view === "speed" && (
        <div className="speed-page">
          <HeroTestPanel
            phase={phase}
            running={running}
            lowData={lowData}
            liveMbps={liveMbps}
            dataUsedMB={dataMB}
            result={result}
            verdict={verdict}
            status={status}
            shareStatus={shareStatus}
            onStart={() => void start()}
            onScore={() => setShowScore(true)}
            onShare={() => void shareResult()}
            onCompare={() => setView("history")}
            canCompare={Boolean(previous)}
          />

          {(preflight || server) && <PreflightServer preflight={preflight} server={server} preOnly={!result} />}
          <ConnectionIdentity server={server} result={result} />
          <MetricGrid
            metrics={METRICS}
            current={result ?? live}
            result={result}
            phase={phase}
            running={running}
            onOpen={setOpenMetric}
          />
          <DiagnosisPanel verdict={verdict} />
          <ImpactPanel verdict={verdict} result={result} />
          <Suspense fallback={<Card className="result-section"><CardContent className="chart-loading"><Skeleton className="h-[280px] w-full" /></CardContent></Card>}>
            <ResultCharts result={result} previous={previous} liveSamples={liveSamples} running={running} />
          </Suspense>
          <RawDataPanel result={result} verdict={verdict} onScore={() => setShowScore(true)} onMethod={() => setShowMethod(true)} />
          <NetPulseFooter />
        </div>
      )}

      {view === "blackbox" && (
        <div className="view-stack">
          <Suspense fallback={<Card className="page-card"><CardContent className="chart-loading"><Skeleton className="h-[420px] w-full" /></CardContent></Card>}>
            <ConnectionBlackBox />
          </Suspense>
          <NetPulseFooter />
        </div>
      )}

      {view === "area" && (
        <div className="view-stack">
          <Suspense fallback={<Card className="page-card"><CardContent className="chart-loading"><Skeleton className="h-[420px] w-full" /></CardContent></Card>}>
            <AreaPulse result={result} />
          </Suspense>
          <NetPulseFooter />
        </div>
      )}

      {view === "fix" && (
        <Suspense fallback={<Card className="page-card"><CardContent className="chart-loading"><Skeleton className="h-[360px] w-full" /></CardContent></Card>}>
          <FixMyInternet lowData={lowData} onMeasured={recordHistory} />
        </Suspense>
      )}

      {view === "connection" && (
        <div className="view-stack">
          <Card className="page-card"><CardContent className="legacy-panel-wrap"><ConnectionPrivacy /></CardContent></Card>
          <NetPulseFooter />
        </div>
      )}

      {view === "history" && (
        <div className="view-stack">
          <HistoryView history={history} onClear={() => { setHistory([]); saveHistory([]); }} />
          <Suspense fallback={<Card className="page-card"><CardContent className="chart-loading"><Skeleton className="h-[360px] w-full" /></CardContent></Card>}>
            <PlanRealityCheck history={history} onHistoryChange={(next) => { setHistory(next); saveHistory(next); }} />
          </Suspense>
          <NetPulseFooter />
        </div>
      )}

      {view === "plan" && (
        <div className="view-stack">
          <Suspense fallback={<Card className="page-card"><CardContent className="chart-loading"><Skeleton className="h-[420px] w-full" /></CardContent></Card>}>
            <PlanRealityCheck history={history} onHistoryChange={(next) => { setHistory(next); saveHistory(next); }} />
          </Suspense>
          <HistoryView history={history} onClear={() => { setHistory([]); saveHistory([]); }} />
          <NetPulseFooter />
        </div>
      )}

      {openDef && <MetricDetail def={openDef} result={result} onClose={() => setOpenMetric(null)} />}
      {showScore && verdict && <ScoreDetail score={verdict.score} parts={verdict.breakdown} onClose={() => setShowScore(false)} />}
      {showMethod && result && <MethodologyModal result={result} verdict={verdict} onClose={() => setShowMethod(false)} />}
    </AppShell>
  );
}

function toRunErrorMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : "The measurement pipeline stopped unexpectedly.";
  return `Test failed — ${detail} Check your connection and retry.`;
}

function formatSpeed(value: number): string {
  return value >= 100 ? String(Math.round(value)) : value.toFixed(1);
}
