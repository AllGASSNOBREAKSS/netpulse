import { useCallback, useRef, useState } from "react";
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
      /* clipboard unavailable */
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

type Stage = "intro" | "baseline_done" | "awaiting" | "concluded";

export function FixMyInternet() {
  const [stage, setStage] = useState<Stage>("intro");
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

  const persist = useCallback((base: Snapshot, outs: StepOutcome[]) => {
    const session: FixSession = {
      id: sessionId,
      startedAt: base.timestamp,
      baseline: base,
      outcomes: outs,
      conclusion: conclude(base, outs),
    };
    saveSession(session);
  }, [sessionId]);

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
  };

  const session: FixSession | null = baseline
    ? { id: sessionId, startedAt: baseline.timestamp, baseline, outcomes, conclusion }
    : null;

  return (
    <div className="panel">
      <div className="panel__head">
        <div>
          <h1 className="panel__title">Fix My Internet</h1>
          <p className="panel__sub">
            A guided A/B workflow: measure a baseline, make one change at a time, and let the
            numbers show what's actually holding your connection back — with an evidence-based
            conclusion that tells you when a faster plan <em>won't</em> help.
          </p>
        </div>
      </div>

      {busy && (
        <div className="fix-progress" role="status">
          <span className="pulse-dot" aria-hidden="true" /> Testing… {PHASE_SHORT[phase] ?? "working"}
          {liveMbps != null && <strong> · {liveMbps >= 100 ? Math.round(liveMbps) : liveMbps.toFixed(1)} Mbps</strong>}
        </div>
      )}

      {/* Intro */}
      {stage === "intro" && (
        <div className="fix-intro">
          <p>
            Each round runs a light test (~15&nbsp;MB, ~10&nbsp;s) so a multi-step session stays
            cheap on data. You'll physically make one change (Ethernet, move to the router,
            disable VPN…), then re-test to compare.
          </p>
          <button className="runbtn" onClick={() => void startBaseline()} disabled={busy}>
            {busy ? "Measuring baseline…" : "Run baseline test"}
          </button>
        </div>
      )}

      {/* Baseline + step recommendation + outcomes */}
      {baseline && (
        <>
          <SnapshotStrip label="Baseline" snap={baseline} />

          {outcomes.map((o) => (
            <OutcomeCard key={o.stepId + o.after.timestamp} outcome={o} />
          ))}

          {stage !== "concluded" && current && (
            <div className="fix-step">
              <div className="fix-step__badge">Recommended next test</div>
              <h2 className="fix-step__label">{current.label}</h2>
              <p className="fix-step__why">{current.why}</p>
              <p className="fix-step__instruction">
                <strong>Do this:</strong> {current.instruction}
              </p>
              <p className="fix-step__isolates">{current.isolates}</p>
              <div className="fix-step__actions">
                <button className="runbtn runbtn--small" onClick={() => void runComparison()} disabled={busy}>
                  I've done it — run comparison
                </button>
                <button className="method-btn" onClick={() => setPicking((p) => !p)} disabled={busy}>
                  Choose a different change
                </button>
              </div>
              {picking && (
                <div className="fix-picker">
                  {remainingSteps(doneIds).map((s) => (
                    <button
                      key={s.id}
                      className="fix-picker__item"
                      onClick={() => {
                        setCurrent({ ...s });
                        setPicking(false);
                      }}
                    >
                      <span>{s.label}</span>
                      <span className="fix-picker__iso">{s.isolates}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {stage !== "concluded" && outcomes.length > 0 && (
            <button className="runbtn" style={{ marginTop: 18 }} onClick={() => setStage("concluded")} disabled={busy}>
              Finish &amp; see conclusion
            </button>
          )}

          {stage === "concluded" && conclusion && session && (
            <ConclusionCard conclusion={conclusion} session={session} onReset={reset} />
          )}
        </>
      )}
    </div>
  );
}

function SnapshotStrip({ label, snap }: { label: string; snap: Snapshot }) {
  const cell = (k: string, v: string) => (
    <div className="stat" key={k}>
      <div className="stat__label">{k}</div>
      <div className="stat__value">{v}</div>
    </div>
  );
  return (
    <>
      <h2 className="panel__h2">{label}</h2>
      <div className="stat-row">
        {cell("download", `${snap.downloadMbps.toFixed(0)} Mbps`)}
        {cell("upload", `${snap.uploadMbps.toFixed(0)} Mbps`)}
        {cell("idle", `${Math.round(snap.idlePingMs)} ms`)}
        {cell("loaded ↓/↑", `${Math.round(snap.loadedDownPingMs)}/${Math.round(snap.loadedUpPingMs)} ms`)}
        {cell("jitter", `${snap.jitterMs.toFixed(1)} ms`)}
        {cell("bufferbloat", snap.bufferbloatGrade)}
        {cell("stability", `${snap.stabilityScore}/100`)}
      </div>
    </>
  );
}

function OutcomeCard({ outcome }: { outcome: StepOutcome }) {
  const deltas = compare(outcome.before, outcome.after);
  return (
    <div className={`outcome outcome--${outcome.helped ? "good" : "flat"}`}>
      <div className="outcome__head">
        <span className={`outcome__tag outcome__tag--${outcome.helped ? "good" : "flat"}`}>
          {outcome.helped ? "helped" : "little change"}
        </span>
        <strong>{outcome.label}</strong>
      </div>
      <p className="outcome__headline">{outcome.headline}</p>
      <table className="cmp">
        <thead>
          <tr>
            <th>metric</th>
            <th className="num">before</th>
            <th className="num">after</th>
            <th className="num">Δ</th>
          </tr>
        </thead>
        <tbody>
          {deltas.map((d) => (
            <tr key={d.key}>
              <td>{d.label}</td>
              <td className="num">{d.before.toFixed(1)}</td>
              <td className="num">{d.after.toFixed(1)}</td>
              <td className={`num cmp__delta cmp__delta--${d.before === d.after ? "flat" : d.better ? "good" : "bad"}`}>
                {d.deltaPct >= 0 ? "+" : ""}
                {d.deltaPct.toFixed(0)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConclusionCard({
  conclusion,
  session,
  onReset,
}: {
  conclusion: NonNullable<FixSession["conclusion"]>;
  session: FixSession;
  onReset: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const upgradeTone =
    conclusion.ispUpgradeHelps === "unlikely" ? "good" : conclusion.ispUpgradeHelps === "possibly" ? "fair" : "flat";
  const stamp = new Date(session.startedAt).toISOString().replace(/[:.]/g, "-");
  return (
    <div className="conclusion">
      <h2 className="panel__h2">Conclusion</h2>
      <div className="conclusion__bottleneck">
        Likely bottleneck: <strong>{conclusion.bottleneck}</strong>
        <span className="conclusion__conf">confidence {conclusion.confidence}%</span>
      </div>
      <p className="conclusion__summary">{conclusion.summary}</p>

      <div className={`conclusion__isp conclusion__isp--${upgradeTone}`}>
        <span className="conclusion__isp-k">Faster ISP plan?</span> {conclusion.ispUpgradeHelps} — {conclusion.ispNote}
      </div>

      {conclusion.evidence.length > 0 && (
        <>
          <h3 className="conclusion__h">Evidence</h3>
          <ul className="diag diag--good">
            {conclusion.evidence.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </>
      )}

      <div className="export-btns" style={{ marginTop: 18 }}>
        <button
          className="runbtn runbtn--small"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(buildFixReport(session));
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Copied ✓" : "Copy report"}
        </button>
        <button
          className="runbtn runbtn--small"
          onClick={() => downloadText(`netpulse-fix-${stamp}.json`, JSON.stringify(fixSessionExport(session), null, 2), "application/json")}
        >
          Export JSON
        </button>
        <button className="runbtn runbtn--small" onClick={() => downloadCsv(`netpulse-fix-${stamp}.csv`, fixCsvRows(session))}>
          Export CSV
        </button>
        <button className="method-btn" onClick={onReset}>
          Start over
        </button>
      </div>
    </div>
  );
}

export type { StepId };
