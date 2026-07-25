import {
  AlertTriangle,
  BatteryWarning,
  CheckCircle2,
  Clock3,
  Copy,
  Database,
  Download,
  EyeOff,
  FileJson,
  FileText,
  Flag,
  Network,
  Pause,
  Play,
  Radio,
  RefreshCcw,
  ShieldCheck,
  Square,
  Trash2,
  WifiOff,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import {
  activeElapsedMs,
  analyzeLagMarker,
  BLACK_BOX_MAX_CUSTOM_MINUTES,
  BLACK_BOX_MIN_CUSTOM_MINUTES,
  createBlackBoxSession,
  customMonitorMode,
  MONITOR_MODES,
  monitoringLimitations,
  normalizeVisibility,
  remainingMs,
  summarizeBlackBoxSession,
  type BlackBoxIncident,
  type BlackBoxSession,
  type MonitorMode,
} from "../lib/blackbox";
import {
  buildSupportReportData,
  createPrivacySafeShareUrl,
  downloadBlackBoxCsv,
  downloadBlackBoxJson,
  downloadSupportReportJson,
  downloadSupportReportText,
  parsePrivacySafeShare,
  type SharedBlackBoxSummary,
} from "../lib/blackboxExport";
import { collectBlackBoxProbe, configuredSecondaryEndpoint } from "../lib/blackboxProbe";
import { runBlackBoxScheduler } from "../lib/blackboxScheduler";
import {
  deleteBlackBoxSession,
  loadBlackBoxSessions,
  loadRetentionDays,
  saveBlackBoxSession,
  saveRetentionDays,
} from "../lib/blackboxSessions";
import { lookupNetworkIdentity } from "../lib/networkIdentity";
import { ArcProgress, ArcTimeline, ArcTimelineItem } from "./ArcTelemetry";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "./ui/chart";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";

const latencyChartConfig = {
  latency: { label: "Latency", color: "var(--chart-1)" },
  jitter: { label: "Consecutive change", color: "var(--chart-3)" },
} satisfies ChartConfig;

const WINDOW_OPTIONS = [
  { value: "1", label: "Last minute" },
  { value: "5", label: "Last 5 minutes" },
  { value: "15", label: "Last 15 minutes" },
  { value: "60", label: "Last hour" },
  { value: "all", label: "Entire session" },
] as const;

type Audience = "ordinary" | "enthusiast" | "support";
type BatteryState = { level: number; charging: boolean };
type BatteryManagerLike = BatteryState & {
  addEventListener: (type: "levelchange" | "chargingchange", listener: () => void) => void;
  removeEventListener: (type: "levelchange" | "chargingchange", listener: () => void) => void;
};

export function ConnectionBlackBox() {
  const initialLoad = useMemo(() => loadBlackBoxSessions(), []);
  const [sessions, setSessions] = useState(initialLoad.value);
  const [session, setSession] = useState<BlackBoxSession | null>(null);
  const sessionRef = useRef<BlackBoxSession | null>(null);
  const [customMinutes, setCustomMinutes] = useState(45);
  const [retentionDays, setRetentionDays] = useState(loadRetentionDays);
  const [storageMessage, setStorageMessage] = useState(initialLoad.ok ? null : initialLoad.error);
  const [reportStatus, setReportStatus] = useState<string | null>(null);
  const [identityStatus, setIdentityStatus] = useState<"idle" | "loading" | "error">("idle");
  const [windowMinutes, setWindowMinutes] = useState<(typeof WINDOW_OPTIONS)[number]["value"]>("5");
  const [audience, setAudience] = useState<Audience>("ordinary");
  const [now, setNow] = useState(() => Date.now());
  const [battery, setBattery] = useState<BatteryState | null>(null);
  const shared = useMemo<SharedBlackBoxSummary | null>(() => parsePrivacySafeShare(typeof location === "undefined" ? "" : location.hash), []);
  const activeSessionId = session?.id ?? null;
  const clockActive = session?.status === "running" || session?.status === "paused";
  const schedulerProbeInterval = session?.status === "running" ? session.mode.probeIntervalMs : null;
  const schedulerDnsInterval = session?.status === "running" ? session.mode.dnsIntervalMs : null;
  const schedulerTraceInterval = session?.status === "running" ? session.mode.traceIntervalMs : null;

  const finishSession = useCallback((status: "completed" | "stopped" | "interrupted", warning: string | null = null) => {
    const endedAt = Date.now();
    setSession((current) => {
      if (!current) return current;
      const pausedDurationMs = current.pauseStartedAt === null ? current.pausedDurationMs : current.pausedDurationMs + endedAt - current.pauseStartedAt;
      return { ...current, status, endedAt, pausedDurationMs, pauseStartedAt: null, storageWarning: warning ?? current.storageWarning };
    });
  }, []);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    if (!clockActive) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [clockActive]);

  useEffect(() => {
    if (!session) return;
    const timer = window.setTimeout(() => {
      const result = saveBlackBoxSession(session, undefined, Date.now(), retentionDays);
      setSessions(result.value);
      setStorageMessage(result.ok ? null : result.error);
    }, 1_500);
    return () => window.clearTimeout(timer);
  }, [session, retentionDays]);

  useEffect(() => {
    const saveBeforeExit = () => {
      const current = sessionRef.current;
      if (current) saveBlackBoxSession(current, undefined, Date.now(), retentionDays);
    };
    window.addEventListener("beforeunload", saveBeforeExit);
    return () => window.removeEventListener("beforeunload", saveBeforeExit);
  }, [retentionDays]);

  useEffect(() => {
    if (!activeSessionId) return;
    const onVisibility = () => {
      const at = Date.now();
      setSession((current) => current ? {
        ...current,
        visibility: [...current.visibility, { id: `visibility-${at}`, at, state: normalizeVisibility(document.visibilityState) }],
      } : current);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [activeSessionId]);

  useEffect(() => {
    const getBattery = (navigator as Navigator & { getBattery?: () => Promise<BatteryManagerLike> }).getBattery;
    if (!getBattery) return;
    let active = true;
    let manager: BatteryManagerLike | null = null;
    const update = () => manager && active && setBattery({ level: manager.level, charging: manager.charging });
    void getBattery.call(navigator).then((next) => {
      if (!active) return;
      manager = next;
      update();
      next.addEventListener("levelchange", update);
      next.addEventListener("chargingchange", update);
    }).catch((error) => console.warn("Battery status is unavailable.", error));
    return () => {
      active = false;
      manager?.removeEventListener("levelchange", update);
      manager?.removeEventListener("chargingchange", update);
    };
  }, []);

  useEffect(() => {
    if (schedulerProbeInterval === null || schedulerDnsInterval === null || schedulerTraceInterval === null || activeSessionId === null) return;
    const controller = new AbortController();
    void runBlackBoxScheduler({
      intervalMs: schedulerProbeInterval,
      signal: controller.signal,
      onTick: async (tick) => {
        const current = sessionRef.current;
        if (!current || current.status !== "running") return;
        if (activeElapsedMs(current) >= current.mode.durationMs) {
          finishSession("completed");
          return;
        }
        const lastDns = current.dns.at(-1)?.measuredAt ?? 0;
        const lastTrace = current.endpoints.at(-1)?.measuredAt ?? 0;
        const measuredAt = Date.now();
        const collected = await collectBlackBoxProbe({
          ...tick,
          visibility: normalizeVisibility(document.visibilityState),
          includeDns: measuredAt - lastDns >= schedulerDnsInterval,
          includeTrace: measuredAt - lastTrace >= schedulerTraceInterval,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setSession((previous) => {
          if (!previous || previous.id !== current.id || previous.status !== "running") return previous;
          const next: BlackBoxSession = {
            ...previous,
            samples: [...previous.samples, collected.sample].slice(-5_000),
            dns: collected.dns ? [...previous.dns, collected.dns].slice(-600) : previous.dns,
            endpoints: collected.endpoint ? [...previous.endpoints, collected.endpoint].slice(-600) : previous.endpoints,
            dataReceivedBytes: previous.dataReceivedBytes + collected.bytesReceived,
          };
          if (activeElapsedMs(next) >= next.mode.durationMs) return { ...next, status: "completed", endedAt: Date.now() };
          return next;
        });
      },
    }).catch((error) => {
      if (!controller.signal.aborted) {
        console.error("Connection Black Box scheduler stopped unexpectedly.", error);
        finishSession("interrupted", "The monitoring scheduler stopped unexpectedly. Recorded evidence was preserved.");
      }
    });
    return () => controller.abort();
  }, [activeSessionId, finishSession, schedulerDnsInterval, schedulerProbeInterval, schedulerTraceInterval]);

  const startSession = (mode: MonitorMode) => {
    const next = createBlackBoxSession(mode, configuredSecondaryEndpoint !== null);
    setSession(next);
    setReportStatus(null);
    setStorageMessage(null);
    setWindowMinutes(mode.durationMs <= 5 * 60_000 ? "5" : "15");
  };

  const pauseSession = () => {
    const pausedAt = Date.now();
    setSession((current) => current?.status === "running" ? { ...current, status: "paused", pauseStartedAt: pausedAt } : current);
  };

  const resumeSession = () => {
    const resumedAt = Date.now();
    setSession((current) => current?.status === "paused" ? {
      ...current,
      status: "running",
      pausedDurationMs: current.pausedDurationMs + (current.pauseStartedAt === null ? 0 : resumedAt - current.pauseStartedAt),
      pauseStartedAt: null,
    } : current);
  };

  const markLag = () => {
    const at = Date.now();
    setSession((current) => current ? { ...current, lagMarkers: [...current.lagMarkers, { id: `lag-${at}`, at, note: null }].slice(-100) } : current);
    setReportStatus("Lag marker saved. Evidence before and after this timestamp will be correlated.");
  };

  const enrichIdentity = async () => {
    if (!session) return;
    setIdentityStatus("loading");
    try {
      const identity = await lookupNetworkIdentity();
      const approximateRegion = [identity.city, identity.region, identity.country ?? identity.countryCode].filter(Boolean).join(", ") || null;
      setSession((current) => current ? { ...current, identity: { isp: identity.isp, asn: identity.asn, approximateRegion, source: identity.source } } : current);
      setIdentityStatus("idle");
    } catch (error) {
      console.warn("Black Box identity enrichment failed.", error);
      setIdentityStatus("error");
    }
  };

  const deleteSession = (id: string) => {
    const result = deleteBlackBoxSession(id);
    setSessions(result.value);
    setStorageMessage(result.ok ? null : result.error);
    if (session?.id === id) setSession(null);
  };

  const changeRetention = (value: string) => {
    const days = Number(value);
    const result = saveRetentionDays(days);
    setRetentionDays(result.value);
    setStorageMessage(result.ok ? null : result.error);
    const refreshed = loadBlackBoxSessions(undefined, Date.now(), result.value);
    setSessions(refreshed.value);
  };

  const copyShareLink = async () => {
    if (!session) return;
    try {
      await navigator.clipboard.writeText(createPrivacySafeShareUrl(session));
      setReportStatus("Privacy-safe summary link copied. Raw samples and identity are excluded.");
    } catch (error) {
      console.warn("Could not copy Black Box share link.", error);
      setReportStatus("Clipboard access is unavailable. JSON and CSV downloads still work.");
    }
  };

  const summary = useMemo(() => session ? summarizeBlackBoxSession(session) : null, [session]);
  const chartData = useMemo(() => session ? buildChartData(session, windowMinutes, now) : [], [session, windowMinutes, now]);

  return (
    <div className="blackbox-page">
      <BlackBoxHero />
      {shared && <SharedSummaryCard shared={shared} />}
      {!session && <ModePicker customMinutes={customMinutes} setCustomMinutes={setCustomMinutes} onStart={startSession} retentionDays={retentionDays} onRetention={changeRetention} />}
      {session && summary && (
        <>
          <SessionCommandBar
            session={session}
            summary={summary}
            now={now}
            onPause={pauseSession}
            onResume={resumeSession}
            onStop={() => finishSession("stopped")}
            onLag={markLag}
            onNew={() => setSession(null)}
          />
          {(battery && !battery.charging && battery.level <= 0.2) && <WarningBanner icon={BatteryWarning} text={`Battery is ${Math.round(battery.level * 100)}% and not charging. Long monitoring sessions can use power.`} />}
          {session.visibility.some((event) => event.state === "hidden") && <WarningBanner icon={EyeOff} text="This session includes background-tab time. Browser scheduling evidence is separated from network incidents." />}
          {storageMessage && <WarningBanner icon={Database} text={storageMessage} />}
          <Tabs defaultValue="overview" className="blackbox-tabs">
            <TabsList aria-label="Connection Black Box views">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="telemetry">Live telemetry</TabsTrigger>
              <TabsTrigger value="incidents">Incidents</TabsTrigger>
              <TabsTrigger value="raw">Raw data</TabsTrigger>
              <TabsTrigger value="report">Report & sessions</TabsTrigger>
            </TabsList>
            <TabsContent value="overview"><Overview session={session} summary={summary} audience={audience} onAudience={setAudience} /></TabsContent>
            <TabsContent value="telemetry"><Telemetry session={session} summary={summary} chartData={chartData} windowMinutes={windowMinutes} onWindow={setWindowMinutes} /></TabsContent>
            <TabsContent value="incidents"><IncidentView session={session} incidents={summary.incidents} /></TabsContent>
            <TabsContent value="raw"><RawData session={session} /></TabsContent>
            <TabsContent value="report">
              <ReportAndSessions
                session={session}
                sessions={sessions}
                reportStatus={reportStatus}
                identityStatus={identityStatus}
                onIdentity={() => void enrichIdentity()}
                onShare={() => void copyShareLink()}
                onOpen={setSession}
                onDelete={deleteSession}
              />
            </TabsContent>
          </Tabs>
        </>
      )}
      {!session && sessions.length > 0 && <SavedSessions sessions={sessions} onOpen={setSession} onDelete={deleteSession} />}
    </div>
  );
}

function BlackBoxHero() {
  return (
    <section className="blackbox-hero" aria-labelledby="blackbox-title">
      <div><span className="section-kicker">Low-data connection evidence</span><h2 id="blackbox-title">Connection Black Box</h2><p>Record real latency, reachability, controlled DNS transactions, endpoint changes, and browser behavior over time—without running continuous bandwidth traffic.</p></div>
      <div className="blackbox-hero__trust"><ShieldCheck aria-hidden="true" /><strong>Evidence, not blame</strong><span>Incidents name what was observed and where. They do not assign ISP responsibility without independent evidence.</span></div>
    </section>
  );
}

function ModePicker({ customMinutes, setCustomMinutes, onStart, retentionDays, onRetention }: { customMinutes: number; setCustomMinutes: (value: number) => void; onStart: (mode: MonitorMode) => void; retentionDays: number; onRetention: (value: string) => void }) {
  return (
    <div className="section-stack">
      <Card className="page-card">
        <CardHeader><span className="section-kicker">Choose a monitoring profile</span><CardTitle>How long should the recorder watch?</CardTitle><CardDescription>Every profile uses zero-byte latency probes plus occasional small DNS and endpoint metadata responses. Estimated usage is application response payload, not total wire overhead.</CardDescription></CardHeader>
        <CardContent className="monitor-mode-grid">
          {MONITOR_MODES.map((item) => <ModeCard key={item.id} mode={item} onStart={onStart} />)}
          <Card className="monitor-mode-card monitor-mode-card--custom">
            <CardHeader><Clock3 aria-hidden="true" /><CardTitle>Custom-duration monitor</CardTitle><CardDescription>Safe range: {BLACK_BOX_MIN_CUSTOM_MINUTES}–{BLACK_BOX_MAX_CUSTOM_MINUTES} minutes.</CardDescription></CardHeader>
            <CardContent><label htmlFor="custom-monitor-minutes">Minutes</label><Input id="custom-monitor-minutes" type="number" min={BLACK_BOX_MIN_CUSTOM_MINUTES} max={BLACK_BOX_MAX_CUSTOM_MINUTES} value={customMinutes} onChange={(event) => setCustomMinutes(Number(event.target.value))} /></CardContent>
            <CardFooter><Button onClick={() => onStart(customMonitorMode(customMinutes))}><Play aria-hidden="true" /> Start custom monitor</Button></CardFooter>
          </Card>
        </CardContent>
      </Card>
      <Card className="page-card capability-card">
        <CardHeader><CardTitle>Measurement availability</CardTitle><CardDescription>Unavailable signals remain visible so a missing measurement is never mistaken for a healthy result.</CardDescription></CardHeader>
        <CardContent className="capability-grid">
          <Capability title="Primary latency & reachability" state="Measured" detail="Zero-byte Cloudflare HTTPS request." />
          <Capability title="Controlled DNS transaction" state="Measured with limitation" detail="Cloudflare DNS over HTTPS; includes transport time." />
          <Capability title="IPv4 / IPv6 reachability" state="Measured periodically" detail="Explicit Cloudflare IP-family trace endpoints." />
          <Capability title="Independent secondary" state={configuredSecondaryEndpoint ? "Configured" : "Unavailable"} detail={configuredSecondaryEndpoint ? "Deployment-provided CORS endpoint." : "Set a documented, authorized CORS endpoint before deployment."} />
          <Capability title="Packet loss" state="Unavailable" detail="Requires a cooperating UDP/TURN service; HTTPS failures are not packet loss." />
          <Capability title="Persistent echo" state="Unavailable" detail="No NetPulse WebSocket/WebTransport echo service is deployed." />
          <Capability title="Upload saturation attribution" state="Unavailable" detail="Lightweight probes do not create or observe sustained upload traffic." />
          <Capability title="Download saturation attribution" state="Unavailable" detail="Lightweight probes do not create or observe sustained download traffic." />
        </CardContent>
        <CardFooter className="retention-control"><label htmlFor="blackbox-retention">Local retention</label><Select value={String(retentionDays)} onValueChange={onRetention}><SelectTrigger id="blackbox-retention"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1">1 day</SelectItem><SelectItem value="7">7 days</SelectItem><SelectItem value="30">30 days</SelectItem><SelectItem value="90">90 days</SelectItem></SelectContent></Select></CardFooter>
      </Card>
    </div>
  );
}

function ModeCard({ mode, onStart }: { mode: MonitorMode; onStart: (mode: MonitorMode) => void }) {
  return (
    <Card className="monitor-mode-card"><CardHeader><Radio aria-hidden="true" /><CardTitle>{mode.label}</CardTitle><CardDescription>{mode.description}</CardDescription></CardHeader><CardContent><dl><div><dt>Probe interval</dt><dd>{formatDuration(mode.probeIntervalMs)}</dd></div><div><dt>Estimated payload</dt><dd>{formatBytes(mode.estimatedPayloadBytes)}</dd></div><div><dt>DNS interval</dt><dd>{formatDuration(mode.dnsIntervalMs)}</dd></div></dl></CardContent><CardFooter><Button variant="outline" onClick={() => onStart(mode)}><Play aria-hidden="true" /> Start monitor</Button></CardFooter></Card>
  );
}

function SessionCommandBar({ session, summary, now, onPause, onResume, onStop, onLag, onNew }: { session: BlackBoxSession; summary: ReturnType<typeof summarizeBlackBoxSession>; now: number; onPause: () => void; onResume: () => void; onStop: () => void; onLag: () => void; onNew: () => void }) {
  const progress = Math.min(100, (activeElapsedMs(session, now) / session.mode.durationMs) * 100);
  const active = session.status === "running" || session.status === "paused";
  return (
    <Card className="page-card session-command-card"><CardHeader><div><Badge variant={session.status === "running" ? "default" : "outline"}>{session.status}</Badge><CardTitle>{session.mode.label}</CardTitle><CardDescription>{summary.sampleCount} probes · {formatBytes(session.dataReceivedBytes)} application payload · {formatDuration(remainingMs(session, now))} remaining</CardDescription></div><div className="session-command-card__actions">{session.status === "running" && <Button variant="outline" onClick={onPause}><Pause aria-hidden="true" /> Pause</Button>}{session.status === "paused" && <Button onClick={onResume}><Play aria-hidden="true" /> Resume</Button>}{active && <Button variant="outline" onClick={onStop}><Square aria-hidden="true" /> Stop</Button>}{!active && <Button variant="outline" onClick={onNew}><RefreshCcw aria-hidden="true" /> New session</Button>}</div></CardHeader><CardContent><ArcProgress value={progress} label={`${Math.round(progress)}% of active monitoring time`} /><Button className="felt-lag-button" onClick={onLag} disabled={!active}><Flag aria-hidden="true" /><span>I Felt Lag</span><small>Save this exact moment and correlate the surrounding evidence</small></Button></CardContent></Card>
  );
}

function Overview({ session, summary, audience, onAudience }: { session: BlackBoxSession; summary: ReturnType<typeof summarizeBlackBoxSession>; audience: Audience; onAudience: (value: Audience) => void }) {
  return (
    <div className="section-stack">
      <Card className="page-card"><CardHeader><div><span className="section-kicker">Session overview</span><CardTitle>{summary.qualityLabel} · {summary.qualityScore}/100</CardTitle><CardDescription>{summary.confidence}% evidence confidence. Packet loss is unavailable and unscored.</CardDescription></div><Select value={audience} onValueChange={(value) => onAudience(value as Audience)}><SelectTrigger aria-label="Choose report audience"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ordinary">Ordinary user</SelectItem><SelectItem value="enthusiast">Networking enthusiast</SelectItem><SelectItem value="support">Technical support</SelectItem></SelectContent></Select></CardHeader><CardContent><OverviewStats summary={summary} />{audience === "ordinary" && <OrdinarySummary summary={summary} />}{audience === "enthusiast" && <EnthusiastSummary session={session} summary={summary} />}{audience === "support" && <SupportSummary session={session} summary={summary} />}</CardContent></Card>
      <Card className="page-card"><CardHeader><CardTitle>Confidence breakdown</CardTitle><CardDescription>Weak browser scheduling, background time, missing supporting probes, or an unfinished session reduce certainty.</CardDescription></CardHeader><CardContent className="confidence-factor-grid">{summary.confidenceFactors.map((factor) => <div key={factor.label}><div><strong>{factor.label}</strong><span>{Math.round(factor.score * factor.weight * 100)}/{Math.round(factor.weight * 100)} points</span></div><ArcProgress value={factor.score * 100} label={`${Math.round(factor.score * 100)}%`} /><p>{factor.evidence}</p></div>)}</CardContent></Card>
    </div>
  );
}

function OverviewStats({ summary }: { summary: ReturnType<typeof summarizeBlackBoxSession> }) {
  const stats = [["Stable time", `${summary.stablePercent.toFixed(1)}%`], ["Degraded time", `${summary.degradedPercent.toFixed(1)}%`], ["Interruption time", `${summary.interruptionPercent.toFixed(1)}%`], ["Median", `${formatMetric(summary.latency.median)} ms`], ["P95", `${formatMetric(summary.latency.p95)} ms`], ["P99", `${formatMetric(summary.latency.p99)} ms`], ["Jitter", `${formatMetric(summary.latency.jitter)} ms`], ["Incidents", String(summary.incidents.length)]];
  return <div className="blackbox-stat-grid">{stats.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>;
}

function OrdinarySummary({ summary }: { summary: ReturnType<typeof summarizeBlackBoxSession> }) {
  return <div className="audience-summary"><h3>What this means</h3><p>{summary.incidents.length === 0 ? "No threshold-defined incident has been detected in the recorded samples so far." : `${summary.incidents.length} incident(s) were detected. The strongest recorded event was ${summary.worstIncident?.title.toLowerCase() ?? "unavailable"}.`}</p><p>{summary.reachabilityFailures > 0 ? `${summary.reachabilityFailures} primary endpoint request(s) failed. This is reachability evidence, not a packet-loss percentage or proof of a full outage.` : "The primary endpoint answered every recorded probe."}</p></div>;
}

function EnthusiastSummary({ session, summary }: { session: BlackBoxSession; summary: ReturnType<typeof summarizeBlackBoxSession> }) {
  return <div className="audience-summary"><h3>Statistical view</h3><p>Min {formatMetric(summary.latency.min)} ms · mean {formatMetric(summary.latency.mean)} ms · median {formatMetric(summary.latency.median)} ms · P95 {formatMetric(summary.latency.p95)} ms · P99 {formatMetric(summary.latency.p99)} ms. Jitter is the mean absolute difference between consecutive successful samples.</p><p>{session.endpoints.length} endpoint metadata observation(s), {session.dns.length} controlled DNS transaction(s), and {summary.schedulingDelayCount} delayed browser schedule(s) were recorded.</p></div>;
}

function SupportSummary({ session, summary }: { session: BlackBoxSession; summary: ReturnType<typeof summarizeBlackBoxSession> }) {
  return <div className="audience-summary"><h3>Support handoff</h3><p>Session {session.id} ran from {new Date(session.startedAt).toLocaleString()} to {session.endedAt ? new Date(session.endedAt).toLocaleString() : "now"}. Confidence is {summary.confidence}%.</p><p>ISP: {session.identity?.isp ?? "unavailable"}; ASN: {session.identity?.asn ?? "unavailable"}; approximate region: {session.identity?.approximateRegion ?? "unavailable"}. Identity is included only after explicit opt-in.</p></div>;
}

function Telemetry({ session, summary, chartData, windowMinutes, onWindow }: { session: BlackBoxSession; summary: ReturnType<typeof summarizeBlackBoxSession>; chartData: ChartDatum[]; windowMinutes: (typeof WINDOW_OPTIONS)[number]["value"]; onWindow: (value: (typeof WINDOW_OPTIONS)[number]["value"]) => void }) {
  const zoom = (direction: -1 | 1) => {
    const index = WINDOW_OPTIONS.findIndex((item) => item.value === windowMinutes);
    onWindow(WINDOW_OPTIONS[Math.max(0, Math.min(WINDOW_OPTIONS.length - 1, index + direction))].value);
  };
  const lagTimes = new Set(session.lagMarkers.map((marker) => formatChartTime(marker.at)));
  return (
    <div className="section-stack">
      <Card className="page-card"><CardHeader><div><CardTitle>Latency and jitter</CardTitle><CardDescription>Real primary-endpoint request duration and consecutive change. Gaps are failed requests, not zeroes.</CardDescription></div><div className="chart-window-controls"><Button variant="outline" size="icon" aria-label="Zoom into a shorter time window" onClick={() => zoom(-1)}><ZoomIn aria-hidden="true" /></Button><Select value={windowMinutes} onValueChange={(value) => onWindow(value as (typeof WINDOW_OPTIONS)[number]["value"])}><SelectTrigger aria-label="Chart time window"><SelectValue /></SelectTrigger><SelectContent>{WINDOW_OPTIONS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select><Button variant="outline" size="icon" aria-label="Zoom out to a longer time window" onClick={() => zoom(1)}><ZoomOut aria-hidden="true" /></Button></div></CardHeader><CardContent><ChartContainer config={latencyChartConfig} className="blackbox-chart"><LineChart data={chartData} accessibilityLayer><CartesianGrid vertical={false} /><XAxis dataKey="time" tickLine={false} axisLine={false} minTickGap={28} /><YAxis tickLine={false} axisLine={false} width={52} unit="ms" /><ChartTooltip content={<ChartTooltipContent />} /><Line dataKey="latency" type="linear" stroke="var(--color-latency)" strokeWidth={2} dot={false} connectNulls={false} /><Line dataKey="jitter" type="linear" stroke="var(--color-jitter)" strokeWidth={1.5} dot={false} connectNulls={false} />{[...lagTimes].map((time) => <ReferenceLine key={time} x={time} stroke="var(--warning)" strokeDasharray="4 4" label="lag" />)}</LineChart></ChartContainer><p className="chart-text-summary">Displayed window contains {chartData.length} decimated point(s). Session median is {formatMetric(summary.latency.median)} ms, P95 {formatMetric(summary.latency.p95)} ms, P99 {formatMetric(summary.latency.p99)} ms, and jitter {formatMetric(summary.latency.jitter)} ms.</p></CardContent></Card>
      <div className="blackbox-two-column"><TimelineCard title="DNS event timeline" empty="No controlled DNS observation yet.">{session.dns.slice(-20).map((item) => <ArcTimelineItem key={item.id} heading={item.status === "ok" ? `DNS transaction ${formatMetric(item.durationMs ?? 0)} ms` : "DNS transaction failed"} date={new Date(item.measuredAt).toLocaleTimeString()}><p>{item.detail}</p></ArcTimelineItem>)}</TimelineCard><TimelineCard title="Endpoint-status timeline" empty="No endpoint metadata observation yet.">{session.endpoints.slice(-20).map((item) => <ArcTimelineItem key={item.id} heading={`Edge ${item.edgeCode ?? "unavailable"} · observed ${item.observedIpFamily}`} date={new Date(item.measuredAt).toLocaleTimeString()}><p>IPv4 {item.ipv4.status}; IPv6 {item.ipv6.status}. These are explicit Cloudflare family endpoints, not independent providers.</p></ArcTimelineItem>)}</TimelineCard></div>
    </div>
  );
}

function TimelineCard({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  return <Card className="page-card"><CardHeader><CardTitle>{title}</CardTitle></CardHeader><CardContent>{Array.isArray(children) && children.length === 0 ? <div className="honest-empty">{empty}</div> : <ArcTimeline>{children}</ArcTimeline>}</CardContent></Card>;
}

function IncidentView({ session, incidents }: { session: BlackBoxSession; incidents: BlackBoxIncident[] }) {
  const lag = session.lagMarkers.map((marker) => analyzeLagMarker(session, marker));
  return <div className="section-stack"><Card className="page-card"><CardHeader><CardTitle>Connectivity event timeline</CardTitle><CardDescription>Incidents are deterministic groupings of observed thresholds. Upload/download attribution is unavailable in this lightweight monitor.</CardDescription></CardHeader><CardContent><div className="incident-attribution-note" role="note"><strong>Attribution boundary: insufficient evidence</strong><p>Upload-related and download-related degradation cannot be classified because this monitor does not generate or observe sustained directional traffic. Run the full Speed Test to measure loaded latency separately.</p></div>{incidents.length === 0 ? <div className="honest-empty">No threshold-defined incident has been detected.</div> : <ArcTimeline>{incidents.map((item) => <ArcTimelineItem key={item.id} heading={`${item.title} · ${item.severity}`} date={`${new Date(item.startAt).toLocaleTimeString()} – ${new Date(item.endAt).toLocaleTimeString()}`}><IncidentDetail incident={item} /></ArcTimelineItem>)}</ArcTimeline>}</CardContent></Card><Card className="page-card"><CardHeader><CardTitle>User lag markers</CardTitle><CardDescription>Each marker analyzes the 15 seconds before and after the recorded moment.</CardDescription></CardHeader><CardContent>{lag.length === 0 ? <div className="honest-empty">Press “I Felt Lag” during an active session to add a timestamp.</div> : <div className="lag-analysis-list">{lag.map((item) => <article key={item.marker.id}><Flag aria-hidden="true" /><div><time>{new Date(item.marker.at).toLocaleString()}</time><strong>{item.statement}</strong><p>{item.confidence}% confidence · {item.evidence.join(" ")}</p></div></article>)}</div>}</CardContent></Card></div>;
}

function IncidentDetail({ incident }: { incident: BlackBoxIncident }) {
  return <dl className="incident-detail"><div><dt>Duration</dt><dd>{formatDuration(incident.durationMs)}</dd></div><div><dt>Confidence</dt><dd>{incident.confidence}%</dd></div><div><dt>Affected endpoint</dt><dd>{incident.affectedEndpoint}</dd></div><div><dt>Evidence</dt><dd>{incident.evidence.join(" ")}</dd></div><div><dt>Possible impact</dt><dd>{incident.possibleImpact}</dd></div></dl>;
}

function RawData({ session }: { session: BlackBoxSession }) {
  const displayed = session.samples.slice(-250);
  return <Card className="page-card"><CardHeader><CardTitle>Raw probe table</CardTitle><CardDescription>Showing the latest {displayed.length} of {session.samples.length} samples. JSON and CSV exports include every retained sample.</CardDescription></CardHeader><CardContent className="raw-table-wrap"><Table><TableHeader><TableRow><TableHead>Scheduled</TableHead><TableHead>Latency</TableHead><TableHead>Primary</TableHead><TableHead>Secondary</TableHead><TableHead>Scheduler delay</TableHead><TableHead>Visibility</TableHead></TableRow></TableHeader><TableBody>{displayed.map((sample) => <TableRow key={sample.id}><TableCell><time>{new Date(sample.scheduledAt).toLocaleTimeString()}</time></TableCell><TableCell>{sample.primary.durationMs === null ? "—" : `${formatMetric(sample.primary.durationMs)} ms`}</TableCell><TableCell>{sample.primary.status}</TableCell><TableCell>{sample.secondary.status}</TableCell><TableCell>{formatMetric(sample.schedulingDelayMs)} ms</TableCell><TableCell>{sample.visibility}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>;
}

function ReportAndSessions({ session, sessions, reportStatus, identityStatus, onIdentity, onShare, onOpen, onDelete }: { session: BlackBoxSession; sessions: BlackBoxSession[]; reportStatus: string | null; identityStatus: "idle" | "loading" | "error"; onIdentity: () => void; onShare: () => void; onOpen: (session: BlackBoxSession) => void; onDelete: (id: string) => void }) {
  const report = buildSupportReportData(session);
  return <div className="section-stack"><Card className="page-card"><CardHeader><CardTitle>Support-ready evidence</CardTitle><CardDescription>Exports exclude full public IP addresses and raw payload contents. The share link contains only a summary in its URL fragment.</CardDescription></CardHeader><CardContent className="report-action-grid"><Button variant="outline" onClick={() => downloadBlackBoxJson(session)}><FileJson aria-hidden="true" /> Full JSON</Button><Button variant="outline" onClick={() => downloadBlackBoxCsv(session)}><Download aria-hidden="true" /> Raw CSV</Button><Button variant="outline" onClick={() => downloadSupportReportJson(session)}><Database aria-hidden="true" /> PDF-ready data</Button><Button variant="outline" onClick={() => downloadSupportReportText(session)}><FileText aria-hidden="true" /> Support report</Button><Button variant="outline" onClick={onShare}><Copy aria-hidden="true" /> Copy safe share link</Button><Button variant="outline" disabled={identityStatus === "loading"} onClick={onIdentity}><Network aria-hidden="true" /> {identityStatus === "loading" ? "Looking up…" : session.identity ? "Refresh ISP context" : "Add ISP context"}</Button></CardContent><CardFooter className="report-status-stack"><p>ISP {report.networkIdentity.isp ?? "unavailable"} · ASN {report.networkIdentity.asn ?? "unavailable"} · approximate region {report.networkIdentity.approximateRegion ?? "unavailable"}. The opt-in lookup contacts ipwho.is.</p>{identityStatus === "error" && <p role="status">Identity lookup failed. No ISP, ASN, or region is being claimed.</p>}{reportStatus && <p role="status">{reportStatus}</p>}</CardFooter></Card><Card className="page-card"><CardHeader><CardTitle>Methodology and limitations</CardTitle></CardHeader><CardContent><Accordion type="multiple"><AccordionItem value="method"><AccordionTrigger>Measurement methodology</AccordionTrigger><AccordionContent><ul className="method-list">{report.methodology.map((item) => <li key={item}>{item}</li>)}</ul></AccordionContent></AccordionItem><AccordionItem value="limits"><AccordionTrigger>Browser and infrastructure limitations</AccordionTrigger><AccordionContent><ul className="method-list">{monitoringLimitations(session).map((item) => <li key={item}>{item}</li>)}</ul></AccordionContent></AccordionItem></Accordion></CardContent></Card><SavedSessions sessions={sessions} activeId={session.id} onOpen={onOpen} onDelete={onDelete} /></div>;
}

function SavedSessions({ sessions, activeId, onOpen, onDelete }: { sessions: BlackBoxSession[]; activeId?: string; onOpen: (session: BlackBoxSession) => void; onDelete: (id: string) => void }) {
  return <Card className="page-card"><CardHeader><CardTitle>Saved Black Box sessions</CardTitle><CardDescription>Sessions are stored only in this browser and pruned by the configured retention period.</CardDescription></CardHeader><CardContent className="saved-session-list">{sessions.map((item) => <div key={item.id} data-active={item.id === activeId || undefined}><button onClick={() => onOpen(item)}><strong>{item.mode.label}</strong><small>{new Date(item.startedAt).toLocaleString()} · {item.samples.length} probes · {item.status}</small></button><Button variant="ghost" size="icon" aria-label={`Delete ${item.mode.label} session`} onClick={() => onDelete(item.id)}><Trash2 aria-hidden="true" /></Button></div>)}</CardContent></Card>;
}

function SharedSummaryCard({ shared }: { shared: SharedBlackBoxSummary }) {
  return <Card className="page-card shared-blackbox-card"><CardHeader><Badge variant="outline">Privacy-safe shared summary</Badge><CardTitle>{shared.quality.label} · {shared.quality.score}/100</CardTitle><CardDescription>{shared.timeframe.mode} started {new Date(shared.timeframe.startedAt).toLocaleString()} · {shared.quality.confidence}% confidence</CardDescription></CardHeader><CardContent><div className="blackbox-stat-grid"><div><span>Median</span><strong>{formatMetric(shared.latency.median)} ms</strong></div><div><span>P95</span><strong>{formatMetric(shared.latency.p95)} ms</strong></div><div><span>Jitter</span><strong>{formatMetric(shared.latency.jitter)} ms</strong></div><div><span>Incidents</span><strong>{shared.incidentCount}</strong></div></div><p>{shared.privacy}</p></CardContent></Card>;
}

function Capability({ title, state, detail }: { title: string; state: string; detail: string }) {
  const available = !state.toLowerCase().includes("unavailable");
  return <div><span>{available ? <CheckCircle2 aria-hidden="true" /> : <WifiOff aria-hidden="true" />}</span><div><strong>{title}</strong><Badge variant="outline">{state}</Badge><p>{detail}</p></div></div>;
}

function WarningBanner({ icon: Icon, text }: { icon: typeof AlertTriangle; text: string }) {
  return <div className="blackbox-warning" role="status"><Icon aria-hidden="true" /><p>{text}</p></div>;
}

type ChartDatum = { time: string; latency: number | null; jitter: number | null };

function buildChartData(session: BlackBoxSession, windowMinutes: string, now: number): ChartDatum[] {
  const cutoff = windowMinutes === "all" ? -Infinity : now - Number(windowMinutes) * 60_000;
  const filtered = session.samples.filter((sample) => sample.startedAt >= cutoff);
  const stride = Math.max(1, Math.ceil(filtered.length / 600));
  return filtered.filter((_, index) => index % stride === 0 || index === filtered.length - 1).map((sample, index, selected) => {
    const latency = sample.primary.durationMs;
    const previous = index > 0 ? selected[index - 1].primary.durationMs : null;
    return { time: formatChartTime(sample.startedAt), latency, jitter: latency === null || previous === null ? null : Math.abs(latency - previous) };
  });
}

function formatChartTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatMetric(value: number): string {
  return value >= 100 ? String(Math.round(value)) : value.toFixed(1);
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${Math.round(milliseconds)} ms`;
  const seconds = milliseconds / 1_000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${minutes.toFixed(minutes < 10 ? 1 : 0)} min`;
  return `${(minutes / 60).toFixed(1)} hr`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} kB`;
  return `${(bytes / 1_000_000).toFixed(2)} MB`;
}
