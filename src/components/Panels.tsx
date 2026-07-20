import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  FileJson,
  FileSpreadsheet,
  Pause,
  Play,
  Search,
  Square,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
import { pingOnce } from "../lib/engine";
import { maskIp } from "../lib/ip";
import { downloadCsv, downloadText } from "../lib/export";
import { lookupNetworkIdentity, type NetworkIdentity } from "../lib/networkIdentity";

/* ============================================================================
   Connection Black Box — a continuous latency recorder.

   Every number on this page comes from probes this page actually sent, or from
   the browser's own PerformanceResourceTiming for those probes. Nothing is
   modelled, smoothed into existence, or filled in while the recorder is idle.
   ========================================================================== */

type Probe = { t: number; rtt: number | null };
type LagMark = { t: number };
type DnsEvent = { t: number; ms: number };

type SessionEvent =
  | { kind: "outage"; t: number; endedAt: number; probes: number }
  | { kind: "lag"; t: number }
  | { kind: "dns"; t: number; ms: number }
  | { kind: "spike"; t: number; rtt: number };

const PROBE_INTERVAL_MS = 500;
const MAX_PROBES = 600; // ~5 minutes of visible window at 500 ms

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/** Mean absolute difference between consecutive probes — the usual jitter definition. */
function jitterOf(values: number[]): number {
  if (values.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < values.length; i++) sum += Math.abs(values[i] - values[i - 1]);
  return sum / (values.length - 1);
}

const dur = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
};

const clock = (t: number) =>
  new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function LatencyMonitor() {
  const [probes, setProbes] = useState<Probe[]>([]);
  const [lagMarks, setLagMarks] = useState<LagMark[]>([]);
  const [dnsEvents, setDnsEvents] = useState<DnsEvent[]>([]);
  const [state, setState] = useState<"idle" | "running" | "paused" | "stopped">("idle");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const runningRef = useRef(false);
  const dnsSeen = useRef(0);

  /* ---- Probe loop. Identical measurement call as before; only the session
     bookkeeping around it is new. ---- */
  useEffect(() => {
    runningRef.current = state === "running";
    if (state !== "running") return;
    let cancelled = false;
    void (async () => {
      while (!cancelled && runningRef.current) {
        const rtt = await pingOnce();
        if (cancelled) break;
        setProbes((prev) => [...prev.slice(-(MAX_PROBES - 1)), { t: Date.now(), rtt }]);
        await new Promise((r) => setTimeout(r, PROBE_INTERVAL_MS));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state]);

  /* ---- Session clock ---- */
  useEffect(() => {
    if (state !== "running" || startedAt === null) return;
    const id = setInterval(() => setElapsed(Date.now() - startedAt), 500);
    return () => clearInterval(id);
  }, [state, startedAt]);

  /* ---- Real DNS events, read from the browser's own resource timing for the
     probes we just sent. A cached resolution reports zero duration, so only
     genuine lookups are recorded. ---- */
  useEffect(() => {
    if (state !== "running") return;
    const id = setInterval(() => {
      const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
      const fresh = entries.slice(dnsSeen.current);
      dnsSeen.current = entries.length;
      const found: DnsEvent[] = [];
      for (const e of fresh) {
        const ms = e.domainLookupEnd - e.domainLookupStart;
        if (ms > 0.5) found.push({ t: performance.timeOrigin + e.startTime, ms });
      }
      if (found.length) setDnsEvents((prev) => [...prev, ...found].slice(-100));
    }, 2000);
    return () => clearInterval(id);
  }, [state]);

  const reset = useCallback(() => {
    setProbes([]);
    setLagMarks([]);
    setDnsEvents([]);
    setElapsed(0);
    dnsSeen.current = performance.getEntriesByType("resource").length;
  }, []);

  const startSession = () => {
    reset();
    setStartedAt(Date.now());
    setState("running");
  };

  /* ------------------------------- Derived ------------------------------- */
  const ok = useMemo(() => probes.filter((p) => p.rtt !== null).map((p) => p.rtt as number), [probes]);
  const sorted = useMemo(() => [...ok].sort((a, b) => a - b), [ok]);
  const median = percentile(sorted, 0.5);
  const p95 = percentile(sorted, 0.95);
  const p99 = percentile(sorted, 0.99);
  const jitter = jitterOf(ok);
  const failed = probes.filter((p) => p.rtt === null).length;
  const spikeThreshold = median > 0 ? Math.max(median * 3, median + 150) : Infinity;

  /** Consecutive failed probes collapse into one connectivity incident. */
  const incidents = useMemo(() => {
    const out: { t: number; endedAt: number; probes: number }[] = [];
    let run: { t: number; endedAt: number; probes: number } | null = null;
    for (const p of probes) {
      if (p.rtt === null) {
        if (run) {
          run.endedAt = p.t;
          run.probes += 1;
        } else run = { t: p.t, endedAt: p.t, probes: 1 };
      } else if (run) {
        out.push(run);
        run = null;
      }
    }
    if (run) out.push(run);
    return out;
  }, [probes]);

  const events = useMemo<SessionEvent[]>(() => {
    const list: SessionEvent[] = [
      ...incidents.map((i) => ({ kind: "outage" as const, ...i })),
      ...lagMarks.map((m) => ({ kind: "lag" as const, t: m.t })),
      ...dnsEvents.map((d) => ({ kind: "dns" as const, t: d.t, ms: d.ms })),
      ...probes
        .filter((p) => p.rtt !== null && p.rtt > spikeThreshold)
        .map((p) => ({ kind: "spike" as const, t: p.t, rtt: p.rtt as number })),
    ];
    return list.sort((a, b) => b.t - a.t).slice(0, 60);
  }, [incidents, lagMarks, dnsEvents, probes, spikeThreshold]);

  const chartData = useMemo(
    () => probes.map((p) => ({ t: clock(p.t), ts: p.t, rtt: p.rtt })),
    [probes],
  );
  const chartConfig = { rtt: { label: "Round-trip time", color: "var(--chart-1)" } } satisfies ChartConfig;

  const active = state === "running" || state === "paused";
  const hasData = probes.length > 0;

  const exportJson = () =>
    downloadText(
      "netpulse-blackbox-session.json",
      JSON.stringify(
        {
          startedAt: startedAt ? new Date(startedAt).toISOString() : null,
          durationMs: elapsed,
          probeIntervalMs: PROBE_INTERVAL_MS,
          summary: { median, p95, p99, jitter, failed, probes: probes.length },
          probes: probes.map((p) => ({ at: new Date(p.t).toISOString(), rttMs: p.rtt })),
          lagMarkers: lagMarks.map((m) => new Date(m.t).toISOString()),
          dnsLookups: dnsEvents.map((d) => ({ at: new Date(d.t).toISOString(), ms: +d.ms.toFixed(2) })),
          incidents: incidents.map((i) => ({
            from: new Date(i.t).toISOString(),
            to: new Date(i.endedAt).toISOString(),
            failedProbes: i.probes,
          })),
        },
        null,
        2,
      ),
      "application/json",
    );

  const exportCsvFile = () =>
    downloadCsv(
      "netpulse-blackbox-probes.csv",
      probes.map((p) => ({ timestamp: new Date(p.t).toISOString(), rtt_ms: p.rtt ?? "" })),
    );

  return (
    <div className="space-y-8">
      <PageHeader
        title="Connection Black Box"
        description="A continuous flight recorder for your connection. It sends a timed HTTPS probe to the nearest measurement edge every half second and records every spike, drop and recovery — leave it running while you game or take a call."
        actions={
          <>
            {state === "idle" || state === "stopped" ? (
              <Button size="sm" onClick={startSession} className="gap-1.5">
                <Play className="size-3.5" /> Start recording
              </Button>
            ) : state === "running" ? (
              <Button size="sm" variant="outline" onClick={() => setState("paused")} className="gap-1.5">
                <Pause className="size-3.5" /> Pause
              </Button>
            ) : (
              <Button size="sm" onClick={() => setState("running")} className="gap-1.5">
                <Play className="size-3.5" /> Resume
              </Button>
            )}
            {active && (
              <Button size="sm" variant="outline" onClick={() => setState("stopped")} className="gap-1.5">
                <Square className="size-3.5" /> Stop
              </Button>
            )}
          </>
        }
      />

      {/* Live session bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card px-5 py-3.5">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <StatusPill tone={state === "running" ? "good" : state === "paused" ? "warn" : "unknown"}>
            {state === "running"
              ? "Recording"
              : state === "paused"
                ? "Paused"
                : state === "stopped"
                  ? "Stopped"
                  : "Not started"}
          </StatusPill>
          <span className="font-mono text-[13px] tabular-nums text-muted-foreground">
            Session {dur(elapsed)}
          </span>
          <span className="font-mono text-[13px] tabular-nums text-muted-foreground">
            {probes.length} probes
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                disabled={state !== "running"}
                onClick={() => setLagMarks((prev) => [...prev, { t: Date.now() }])}
                className="gap-1.5"
              >
                <Zap className="size-3.5" /> I Felt Lag
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Drops a marker at this instant so you can line up what you felt with what was measured.
            </TooltipContent>
          </Tooltip>
          <Button size="sm" variant="outline" onClick={exportCsvFile} disabled={!hasData} className="gap-1.5">
            <FileSpreadsheet className="size-3.5" /> CSV
          </Button>
          <Button size="sm" variant="outline" onClick={exportJson} disabled={!hasData} className="gap-1.5">
            <FileJson className="size-3.5" /> JSON
          </Button>
        </div>
      </div>

      {!hasData ? (
        <EmptyState
          icon={Activity}
          title={state === "idle" ? "Recorder is not running" : "Waiting for the first probe"}
          description="Start the recorder and this page fills with your connection's real latency trace — median, tail latency, jitter, outages and DNS lookups, all measured live."
          action={
            state === "idle" || state === "stopped" ? (
              <Button onClick={startSession} className="gap-1.5">
                <Play className="size-4" /> Start recording
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <StatGrid
            columns={3}
            stats={[
              { label: "Median latency", value: `${Math.round(median)} ms` },
              { label: "P95", value: `${Math.round(p95)} ms`, tone: p95 > median * 2 ? "warn" : "default" },
              { label: "P99", value: `${Math.round(p99)} ms`, tone: p99 > median * 3 ? "warn" : "default" },
              { label: "Jitter", value: `${jitter.toFixed(1)} ms`, tone: jitter > 30 ? "warn" : "good" },
              {
                label: "Connectivity incidents",
                value: String(incidents.length),
                tone: incidents.length ? "bad" : "good",
                hint: `${failed} failed probes`,
              },
              { label: "Lag markers", value: String(lagMarks.length), hint: "reported by you" },
            ]}
          />

          <Section
            title="Live latency"
            description={`Each point is one measured round trip. ${lagMarks.length ? "Vertical marks are the moments you reported lag." : ""}`}
          >
            <Panel className="p-4 sm:p-5">
              <ChartContainer config={chartConfig} className="h-64 w-full">
                <AreaChart data={chartData} margin={{ left: 4, right: 12, top: 8 }}>
                  <defs>
                    <linearGradient id="np-bb-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-rtt)" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="var(--color-rtt)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} strokeOpacity={0.3} />
                  <XAxis dataKey="t" tickLine={false} axisLine={false} fontSize={10} minTickGap={40} />
                  <YAxis tickLine={false} axisLine={false} fontSize={11} width={44} unit=" ms" />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area
                    dataKey="rtt"
                    type="monotone"
                    stroke="var(--color-rtt)"
                    strokeWidth={2}
                    fill="url(#np-bb-fill)"
                    connectNulls={false}
                    isAnimationActive={false}
                    dot={false}
                  />
                  {lagMarks.map((m) => (
                    <ReferenceLine
                      key={m.t}
                      x={clock(m.t)}
                      stroke="var(--status-warn)"
                      strokeDasharray="3 3"
                    />
                  ))}
                </AreaChart>
              </ChartContainer>
              <p className="mt-2 text-[12px] text-muted-foreground">
                Gaps in the line are probes that never came back — see the event timeline below.
              </p>
            </Panel>
          </Section>

          <Section
            title="Event timeline"
            description="Outages, latency spikes, DNS lookups and your own lag markers, newest first."
          >
            {events.length === 0 ? (
              <Panel tone="quiet">
                <p className="text-[13.5px] text-muted-foreground">
                  Nothing notable so far — no dropped probes, no spikes above three times the median.
                </p>
              </Panel>
            ) : (
              <ul className="divide-y divide-border/70 rounded-xl border border-border bg-card px-5">
                {events.map((e, i) => (
                  <li key={`${e.kind}-${e.t}-${i}`} className="flex items-baseline gap-4 py-3">
                    <span className="w-20 shrink-0 font-mono text-[12px] tabular-nums text-muted-foreground">
                      {clock(e.t)}
                    </span>
                    <span className="min-w-0 flex-1 text-[13.5px]">
                      {e.kind === "outage" && (
                        <>
                          <StatusPill tone="bad" className="mr-2 text-status-bad">
                            Connectivity incident
                          </StatusPill>
                          {e.probes} consecutive probe{e.probes === 1 ? "" : "s"} failed
                          {e.endedAt > e.t ? ` over ${dur(e.endedAt - e.t)}` : ""}.
                        </>
                      )}
                      {e.kind === "spike" && (
                        <>
                          <StatusPill tone="warn" className="mr-2 text-status-warn">
                            Latency spike
                          </StatusPill>
                          {Math.round(e.rtt)} ms — over three times the session median.
                        </>
                      )}
                      {e.kind === "dns" && (
                        <>
                          <StatusPill tone="neutral" className="mr-2">
                            DNS lookup
                          </StatusPill>
                          resolved in {e.ms.toFixed(1)} ms.
                        </>
                      )}
                      {e.kind === "lag" && (
                        <>
                          <StatusPill tone="warn" className="mr-2 text-status-warn">
                            You reported lag
                          </StatusPill>
                          marker placed for comparison against the trace.
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {state === "stopped" && (
            <Section title="Session summary">
              <Panel>
                <KeyValueList
                  items={[
                    { k: "Started", v: startedAt ? new Date(startedAt).toLocaleString() : "—", mono: false },
                    { k: "Duration", v: dur(elapsed) },
                    { k: "Probes sent", v: String(probes.length) },
                    { k: "Median latency", v: `${Math.round(median)} ms` },
                    { k: "P95 / P99", v: `${Math.round(p95)} / ${Math.round(p99)} ms` },
                    { k: "Jitter", v: `${jitter.toFixed(1)} ms` },
                    { k: "Failed probes", v: String(failed) },
                    { k: "Connectivity incidents", v: String(incidents.length) },
                    { k: "Lag markers", v: String(lagMarks.length) },
                    { k: "DNS lookups observed", v: String(dnsEvents.length) },
                  ]}
                />
              </Panel>
            </Section>
          )}

          <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-muted-foreground">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            A browser measures the path to the measurement edge, not your router or Wi-Fi link
            specifically. A recorded incident means this page could not reach the edge — it does not
            by itself identify which hop failed.
          </p>
        </>
      )}
    </div>
  );
}

/* ============================================================================
   Connection & Privacy — neutral facts about what the outside world sees.
   These are properties of every internet connection, not vulnerabilities, and
   the status vocabulary here says so.
   ========================================================================== */

type TraceInfo = Record<string, string>;

export function ConnectionPrivacy() {
  const [trace, setTrace] = useState<TraceInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [revealIp, setRevealIp] = useState(false);
  const [identity, setIdentity] = useState<NetworkIdentity | null>(null);
  const [lookupState, setLookupState] = useState<"idle" | "loading" | "error">("idle");

  useEffect(() => {
    let cancelled = false;
    fetch("https://speed.cloudflare.com/cdn-cgi/trace", { cache: "no-store" })
      .then((r) => r.text())
      .then((t) => {
        if (cancelled) return;
        const info: TraceInfo = {};
        for (const line of t.trim().split("\n")) {
          const [k, v] = line.split("=");
          if (k && v) info[k] = v;
        }
        setTrace(info);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const runLookup = async () => {
    setLookupState("loading");
    try {
      setIdentity(await lookupNetworkIdentity());
      setLookupState("idle");
    } catch {
      setLookupState("error");
    }
  };

  const rawIp = trace?.ip ?? "";
  const ipDisplay = rawIp ? (revealIp ? rawIp : maskIp(rawIp)) : failed ? "unavailable" : "…";
  const pend = failed ? "unavailable" : "…";

  const secureTone: StatusTone = window.isSecureContext ? "good" : "warn";

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <PageHeader
        title="Connection & Privacy"
        description="What the outside world can see about your connection right now. These are normal properties of every internet connection, not vulnerabilities — each one is labelled with an honest status rather than an alarm."
      />

      <Section
        title="Public internet identity"
        description="Read from the measurement provider's echo of your own request. No extra parties are contacted and nothing is stored."
        actions={<StatusPill tone="neutral">Available</StatusPill>}
      >
        <KeyValueList
          items={[
            {
              k: "Public IP",
              v: (
                <span className="inline-flex items-baseline gap-2">
                  <span className="truncate">{ipDisplay}</span>
                  {rawIp && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-[10px] uppercase tracking-wider"
                      onClick={() => setRevealIp((x) => !x)}
                    >
                      {revealIp ? "mask" : "reveal"}
                    </Button>
                  )}
                </span>
              ),
            },
            { k: "Serving edge", v: trace?.colo ?? pend },
            { k: "IP masking in this UI", v: revealIp ? "revealed by you" : "masked by default", mono: false },
          ]}
        />
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          Every site you visit already sees your public IP — that is how the internet routes replies
          back to you. NetPulse masks it by default so a screenshot or screen share does not leak it,
          and never includes it in exports or shared reports.
        </p>
      </Section>

      <Section
        title="Approximate location"
        description="Optional lookup via ipwho.is. Running it discloses your public IP to that service, so it only happens when you ask. Results are registry estimates describing your network's routing region — never a street address — and are not saved to history or exports."
        actions={<StatusPill tone={identity ? "neutral" : "unknown"}>{identity ? "Available" : "Not requested"}</StatusPill>}
      >
        {identity ? (
          <KeyValueList
            items={[
              { k: "ISP", v: identity.isp ?? "unknown", mono: false },
              { k: "ASN", v: identity.asn ?? "unknown" },
              {
                k: "Approx. area",
                v: [identity.city, identity.region, identity.country].filter(Boolean).join(", ") || "unknown",
                mono: false,
              },
              { k: "IP family", v: identity.ipFamily },
              { k: "Source", v: identity.source, mono: false },
            ]}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" onClick={() => void runLookup()} disabled={lookupState === "loading"} className="gap-1.5">
              <Search className="size-3.5" />
              {lookupState === "loading" ? "Looking up…" : "Run optional lookup"}
            </Button>
            {lookupState === "error" && (
              <span className="text-[12.5px] text-status-warn">Lookup failed or timed out — try again.</span>
            )}
          </div>
        )}
      </Section>

      <Section
        title="Secure connection"
        description="Whether this page and its measurements travel over an encrypted channel."
        actions={<StatusPill tone={secureTone}>{window.isSecureContext ? "Protected" : "Attention recommended"}</StatusPill>}
      >
        <KeyValueList
          items={[
            { k: "Secure context", v: window.isSecureContext ? "yes (HTTPS)" : "no", mono: false },
            { k: "TLS version", v: trace?.tls ?? pend },
            { k: "HTTP version", v: trace?.http ?? pend },
          ]}
        />
      </Section>

      <Section
        title="DNS"
        description="What a web page can and cannot observe about name resolution."
        actions={<StatusPill tone="unknown">Limited</StatusPill>}
      >
        <KeyValueList
          items={[
            { k: "Resolver in use", v: "not exposed to web pages", mono: false },
            { k: "DNS-over-HTTPS in effect", v: "not detectable from a browser", mono: false },
            { k: "Lookup timing", v: "observable per request (see Connection Black Box)", mono: false },
          ]}
        />
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          Browsers deliberately hide which resolver your system uses. NetPulse reports the lookup
          timings it can genuinely observe and says nothing about the rest.
        </p>
      </Section>

      <Section
        title="Browser privacy"
        description="Signals this browser exposes to any site you visit."
        actions={<StatusPill tone="neutral">Available</StatusPill>}
      >
        <KeyValueList
          items={[
            { k: "Cloudflare WARP", v: trace ? (trace.warp === "on" ? "on" : "off") : pend },
            { k: "Do Not Track", v: navigator.doNotTrack === "1" ? "enabled" : "not enabled", mono: false },
            { k: "Language", v: navigator.language },
            { k: "Timezone", v: Intl.DateTimeFormat().resolvedOptions().timeZone, mono: false },
            { k: "Cookies enabled", v: navigator.cookieEnabled ? "yes" : "no", mono: false },
          ]}
        />
      </Section>

      <Section
        title="Local storage"
        description="What NetPulse keeps on this device, and how to remove it."
        actions={<StatusPill tone="good">Protected</StatusPill>}
      >
        <KeyValueList
          items={[
            { k: "Test history", v: "localStorage on this device only", mono: false },
            { k: "Theme preference", v: "localStorage on this device only", mono: false },
            { k: "Sent to a server", v: "nothing — there is no backend", mono: false },
            { k: "How to clear", v: "History → Clear all, or clear site data", mono: false },
          ]}
        />
      </Section>

      <Section
        title="Shared results"
        description="What leaves your device when you use Share Result or an export."
        actions={<StatusPill tone="good">Protected</StatusPill>}
      >
        <KeyValueList
          items={[
            { k: "Full public IP", v: "never included", mono: false },
            { k: "Masked IP", v: "included", mono: false },
            { k: "Approximate area", v: "included only if you ran the lookup", mono: false },
            { k: "Upload destination", v: "none — exports are local files", mono: false },
          ]}
        />
      </Section>

      <Section
        title="Data handling"
        actions={<StatusPill tone="good">Protected</StatusPill>}
      >
        <KeyValueList
          items={[
            { k: "Backend / accounts", v: "none — fully client-side", mono: false },
            { k: "Analytics / trackers", v: "none", mono: false },
            { k: "Third parties contacted", v: "measurement edge; ipwho.is only on request", mono: false },
            { k: "Source code", v: "open, AGPL-3.0", mono: false },
          ]}
        />
      </Section>
    </div>
  );
}
