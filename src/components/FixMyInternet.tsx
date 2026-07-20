import { useCallback, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  FileJson,
  FileSpreadsheet,
  MinusCircle,
  RotateCcw,
  Share2,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, KeyValueList, PageHeader, Panel, Section, StatGrid, StatusPill } from "@/components/np/Layout";
import { cn } from "@/lib/utils";
import { runTest, type Phase, type TestResult } from "../lib/engine";
import { downloadCsv, downloadText } from "../lib/export";
import {
  buildFixReport,
  compare,
  conclude,
  evaluateStep,
  fixCsvRows,
  fixSessionExport,
  recommendStep,
  remainingSteps,
  snapshot,
  type FixSession,
  type FixStep,
  type Snapshot,
  type StepId,
  type StepOutcome,
} from "../lib/fixit";

const KEY = "netpulse_fixit";

function loadSessions(): FixSession[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}
function saveSession(s: FixSession) {
  try {
    const all = loadSessions().filter((x) => x.id !== s.id);
    localStorage.setItem(KEY, JSON.stringify([s, ...all].slice(0, 20)));
  } catch {
    /* localStorage unavailable */
  }
}

const PHASE_SHORT: Partial<Record<Phase, string>> = {
  preflight: "inspecting",
  server: "selecting server",
  latency: "latency",
  download_single: "download (1)",
  download_multi: "download (multi)",
  upload: "upload",
  packetloss: "UDP check",
};

/**
 * Symptom selection is CONTEXT, not diagnosis. It frames the session and is
 * carried into the exported report, but the recommended next test still comes
 * from `recommendStep` — i.e. from measurements, never from what you clicked.
 */
const SYMPTOMS = [
  { id: "slow", label: "Everything feels slow", note: "Pages, downloads and streams all crawl." },
  { id: "calls", label: "Video calls break up", note: "Audio robotic, video freezing, others cut out." },
  { id: "gaming", label: "Games lag or rubber-band", note: "Fine most of the time, terrible in moments." },
  { id: "shared", label: "Bad when others are online", note: "One person streaming ruins it for everyone." },
  { id: "rooms", label: "Only in some rooms", note: "Great near the router, poor further away." },
  { id: "evening", label: "Only at certain times", note: "Fine by day, unusable in the evening." },
] as const;

type SymptomId = (typeof SYMPTOMS)[number]["id"];
type Stage = "intro" | "baseline_done" | "awaiting" | "concluded";

export function FixMyInternet() {
  const [stage, setStage] = useState<Stage>("intro");
  const [symptom, setSymptom] = useState<SymptomId | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [liveMbps, setLiveMbps] = useState<number | null>(null);
  const [baseline, setBaseline] = useState<Snapshot | null>(null);
  const [outcomes, setOutcomes] = useState<StepOutcome[]>([]);
  const [current, setCurrent] = useState<FixStep | null>(null);
  const [picking, setPicking] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const running = useRef(false);

  const doneIds = outcomes.map((o) => o.stepId);
  const conclusion = baseline ? conclude(baseline, outcomes) : null;

  const runQuick = useCallback(async (): Promise<TestResult> => {
    setBusy(true);
    setLiveMbps(null);
    try {
      return await runTest(
        { lowData: true, profile: "quick" },
        {
          onPhase: setPhase,
          onSample: (s) => {
            if (s.mbps !== undefined) setLiveMbps(s.mbps);
          },
        },
      );
    } finally {
      setBusy(false);
      setPhase("idle");
    }
  }, []);

  const persist = useCallback(
    (base: Snapshot, outs: StepOutcome[]) => {
      saveSession({
        id: sessionId,
        startedAt: base.timestamp,
        baseline: base,
        outcomes: outs,
        conclusion: conclude(base, outs),
      });
    },
    [sessionId],
  );

  const startBaseline = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setOutcomes([]);
    setCurrent(null);
    try {
      const r = await runQuick();
      const base = snapshot(r);
      setSessionId(`fix-${r.timestamp}`);
      setBaseline(base);
      setCurrent(recommendStep(base, []));
      setStage("baseline_done");
      persist(base, []);
    } finally {
      running.current = false;
    }
  }, [runQuick, persist]);

  const runComparison = useCallback(async () => {
    if (running.current || !baseline || !current) return;
    running.current = true;
    try {
      const r = await runQuick();
      const after = snapshot(r);
      const outcome = evaluateStep(current.id, baseline, after);
      const next = [...outcomes, outcome];
      setOutcomes(next);
      persist(baseline, next);
      setCurrent(recommendStep(baseline, next.map((o) => o.stepId)));
      setStage("awaiting");
    } finally {
      running.current = false;
    }
  }, [baseline, current, outcomes, runQuick, persist]);

  const reset = () => {
    setStage("intro");
    setBaseline(null);
    setOutcomes([]);
    setCurrent(null);
    setSymptom(null);
  };

  const session: FixSession | null = baseline
    ? { id: sessionId, startedAt: baseline.timestamp, baseline, outcomes, conclusion }
    : null;

  const symptomLabel = SYMPTOMS.find((s) => s.id === symptom)?.label ?? null;
  const stepNumber = outcomes.length + 1;

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <PageHeader
        title="Fix My Internet"
        description="A guided A/B workflow: measure a baseline, change one thing at a time, and let the numbers show what is actually holding your connection back — including when a faster plan would not help."
        actions={baseline ? <StatusPill tone="neutral">Step {stepNumber}</StatusPill> : undefined}
      />

      {busy && (
        <div
          className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-5 py-3.5 font-mono text-[12.5px] text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          <span className="pulse-dot" aria-hidden="true" />
          Testing… {PHASE_SHORT[phase] ?? "working"}
          {liveMbps != null && (
            <strong className="text-foreground">
              · {liveMbps >= 100 ? Math.round(liveMbps) : liveMbps.toFixed(1)} Mbps
            </strong>
          )}
        </div>
      )}

      {/* ------------------------------- Intro ------------------------------ */}
      {stage === "intro" && (
        <>
          <Section
            title="What are you seeing?"
            description="This frames the session and travels with the exported report. It does not decide the diagnosis — the recommended tests come from your measurements."
          >
            <div className="grid gap-2.5 sm:grid-cols-2">
              {SYMPTOMS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSymptom(s.id)}
                  aria-pressed={symptom === s.id}
                  className={cn(
                    "rounded-xl border px-4 py-3.5 text-left transition-[border-color,background-color,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/50",
                    symptom === s.id ? "border-primary/60 bg-primary/[0.08]" : "border-border",
                  )}
                >
                  <span className="block text-[14px] font-medium">{s.label}</span>
                  <span className="mt-0.5 block text-[12.5px] text-muted-foreground">{s.note}</span>
                </button>
              ))}
            </div>
          </Section>

          <Section title="Measure a baseline">
            <p className="max-w-2xl text-[13.5px] leading-relaxed text-muted-foreground">
              Each round runs a light test (~15 MB, ~10 s) so a multi-step session stays cheap on
              data. After the baseline you will physically make one change — plug in Ethernet, move
              next to the router, turn off the VPN — and re-test so the two runs can be compared.
            </p>
            <Button
              size="lg"
              onClick={() => void startBaseline()}
              disabled={busy}
              className="h-11 gap-2 transition-transform active:scale-[0.98]"
            >
              <Wrench className="size-4" />
              {busy ? "Measuring baseline…" : "Run baseline test"}
            </Button>
          </Section>
        </>
      )}

      {/* ---------------------------- Session ------------------------------- */}
      {baseline && (
        <>
          {symptomLabel && (
            <Panel tone="quiet" className="py-3">
              <p className="text-[13px] text-muted-foreground">
                Reported symptom: <span className="text-foreground">{symptomLabel}</span>
              </p>
            </Panel>
          )}

          <Section title="Baseline" description="Your starting point — every later run is compared against this.">
            <StatGrid
              columns={4}
              size="sm"
              stats={[
                { label: "Download", value: `${baseline.downloadMbps.toFixed(0)} Mbps` },
                { label: "Upload", value: `${baseline.uploadMbps.toFixed(0)} Mbps` },
                { label: "Idle latency", value: `${Math.round(baseline.idlePingMs)} ms` },
                {
                  label: "Loaded ↓/↑",
                  value: `${Math.round(baseline.loadedDownPingMs)}/${Math.round(baseline.loadedUpPingMs)} ms`,
                },
                { label: "Jitter", value: `${baseline.jitterMs.toFixed(1)} ms` },
                { label: "Bufferbloat", value: baseline.bufferbloatGrade },
                { label: "Stability", value: `${baseline.stabilityScore}/100` },
                { label: "Rounds run", value: String(outcomes.length + 1) },
              ]}
            />
          </Section>

          {/* Evidence timeline */}
          {outcomes.length > 0 && (
            <Section title="Evidence timeline" description="Each change you made, and what the measurements did.">
              <ol className="space-y-4">
                {outcomes.map((o, i) => (
                  <OutcomeItem key={o.stepId + o.after.timestamp} outcome={o} index={i + 1} />
                ))}
              </ol>
            </Section>
          )}

          {/* Next guided step */}
          {stage !== "concluded" && current && (
            <Section title="Recommended next test">
              <Panel tone="accent" className="space-y-4">
                <div className="space-y-1.5">
                  <h3 className="text-[17px] font-semibold tracking-tight">{current.label}</h3>
                  <p className="text-[13.5px] leading-relaxed text-muted-foreground">{current.why}</p>
                </div>

                <div className="rounded-lg bg-background/60 px-4 py-3">
                  <p className="text-[13.5px] leading-relaxed">
                    <strong className="font-semibold">Do this:</strong> {current.instruction}
                  </p>
                </div>

                <p className="text-[12.5px] text-muted-foreground">{current.isolates}</p>

                <div className="flex flex-wrap gap-2.5">
                  <Button onClick={() => void runComparison()} disabled={busy} className="gap-2">
                    I've done it — run comparison <ArrowRight className="size-4" />
                  </Button>
                  <Button variant="outline" onClick={() => setPicking((p) => !p)} disabled={busy}>
                    Choose a different change
                  </Button>
                </div>

                {picking && (
                  <ul className="divide-y divide-border/70 rounded-lg border border-border bg-card">
                    {remainingSteps(doneIds).map((s) => (
                      <li key={s.id}>
                        <button
                          className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-accent"
                          onClick={() => {
                            setCurrent({ ...s });
                            setPicking(false);
                          }}
                        >
                          <span className="text-[13.5px] font-medium">{s.label}</span>
                          <span className="hidden text-right text-[12px] text-muted-foreground sm:block">
                            {s.isolates}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </Section>
          )}

          {stage !== "concluded" && outcomes.length === 0 && !current && (
            <EmptyState
              title="No further comparisons to suggest"
              description="Every isolation step has been tried. Finish the session to see the conclusion."
            />
          )}

          {stage !== "concluded" && outcomes.length > 0 && (
            <Button variant="outline" onClick={() => setStage("concluded")} disabled={busy} className="gap-2">
              Finish &amp; see conclusion <ArrowRight className="size-4" />
            </Button>
          )}

          {stage === "concluded" && conclusion && session && (
            <Conclusion conclusion={conclusion} session={session} symptom={symptomLabel} onReset={reset} />
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------ Outcome item ------------------------------ */

function OutcomeItem({ outcome, index }: { outcome: StepOutcome; index: number }) {
  const deltas = compare(outcome.before, outcome.after);
  const Icon = outcome.helped ? CheckCircle2 : MinusCircle;

  return (
    <li className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border/70 px-5 py-3.5">
        <span className="font-mono text-[12px] text-muted-foreground">{String(index).padStart(2, "0")}</span>
        <Icon
          className={cn("size-4 shrink-0", outcome.helped ? "text-status-good" : "text-muted-foreground")}
          aria-hidden="true"
        />
        <span className="text-[14.5px] font-medium">{outcome.label}</span>
        <StatusPill tone={outcome.helped ? "good" : "unknown"} className="ml-auto">
          {outcome.helped ? "Helped" : "Little change"}
        </StatusPill>
      </div>

      <div className="px-5 py-4">
        <p className="text-[13.5px] leading-relaxed text-muted-foreground">{outcome.headline}</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[26rem] border-collapse text-[13px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                <th className="pb-2 font-medium">Metric</th>
                <th className="pb-2 text-right font-medium">Before</th>
                <th className="pb-2 text-right font-medium">After</th>
                <th className="pb-2 text-right font-medium">Change</th>
              </tr>
            </thead>
            <tbody>
              {deltas.map((d) => (
                <tr key={d.key} className="border-t border-border/60">
                  <td className="py-2">{d.label}</td>
                  <td className="py-2 text-right font-mono tabular-nums text-muted-foreground">
                    {d.before.toFixed(1)}
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums">{d.after.toFixed(1)}</td>
                  <td
                    className={cn(
                      "py-2 text-right font-mono tabular-nums",
                      d.before === d.after
                        ? "text-muted-foreground"
                        : d.better
                          ? "text-status-good"
                          : "text-status-warn",
                    )}
                  >
                    {d.deltaPct >= 0 ? "+" : ""}
                    {d.deltaPct.toFixed(0)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </li>
  );
}

/* ------------------------------- Conclusion ------------------------------- */

function Conclusion({
  conclusion,
  session,
  symptom,
  onReset,
}: {
  conclusion: NonNullable<FixSession["conclusion"]>;
  session: FixSession;
  symptom: string | null;
  onReset: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const stamp = new Date(session.startedAt).toISOString().replace(/[:.]/g, "-");

  const upgradeTone: "good" | "warn" | "unknown" =
    conclusion.ispUpgradeHelps === "unlikely" ? "good" : conclusion.ispUpgradeHelps === "possibly" ? "warn" : "unknown";

  return (
    <div className="space-y-8">
      <Section title="Likely cause">
        <Panel className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <p className="text-[20px] font-semibold tracking-tight">{conclusion.bottleneck}</p>
            <StatusPill tone="neutral">Confidence {conclusion.confidence}%</StatusPill>
          </div>
          <p className="text-[14px] leading-relaxed text-muted-foreground">{conclusion.summary}</p>
          <KeyValueList
            items={[
              ...(symptom ? [{ k: "Reported symptom", v: symptom, mono: false }] : []),
              { k: "Comparisons run", v: String(session.outcomes.length) },
            ]}
          />
        </Panel>
      </Section>

      <Section title="Would a faster plan help?" actions={<StatusPill tone={upgradeTone}>{conclusion.ispUpgradeHelps}</StatusPill>}>
        <p className="text-[14px] leading-relaxed text-muted-foreground">{conclusion.ispNote}</p>
      </Section>

      {conclusion.evidence.length > 0 && (
        <Section title="Prioritised fixes" description="Ordered by what your own measurements support.">
          <ol className="space-y-3">
            {conclusion.evidence.map((e, i) => (
              <li key={e} className="flex gap-3.5 text-[14px] leading-relaxed">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary font-mono text-[11px] text-secondary-foreground">
                  {i + 1}
                </span>
                <span>{e}</span>
              </li>
            ))}
          </ol>
        </Section>
      )}

      <Section title="Save or share this report">
        <div className="flex flex-wrap gap-2.5">
          <Button
            variant="outline"
            className="gap-1.5"
            onClick={async () => {
              try {
                const header = symptom ? `Reported symptom: ${symptom}\n\n` : "";
                await navigator.clipboard.writeText(header + buildFixReport(session));
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              } catch {
                setCopied(false);
              }
            }}
          >
            <Share2 className="size-3.5" /> {copied ? "Copied ✓" : "Copy report"}
          </Button>
          <Button
            variant="outline"
            className="gap-1.5"
            onClick={() =>
              downloadText(
                `netpulse-fix-${stamp}.json`,
                JSON.stringify(fixSessionExport(session), null, 2),
                "application/json",
              )
            }
          >
            <FileJson className="size-3.5" /> JSON
          </Button>
          <Button
            variant="outline"
            className="gap-1.5"
            onClick={() => downloadCsv(`netpulse-fix-${stamp}.csv`, fixCsvRows(session))}
          >
            <FileSpreadsheet className="size-3.5" /> CSV
          </Button>
          <Button variant="ghost" onClick={onReset} className="gap-1.5 text-muted-foreground">
            <RotateCcw className="size-3.5" /> Start over
          </Button>
        </div>
      </Section>
    </div>
  );
}

export type { StepId };
