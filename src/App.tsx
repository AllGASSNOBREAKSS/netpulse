import { useCallback, useEffect, useRef, useState } from "react";
import Scope from "./components/Scope";
import { runTest, type Phase, type Sample, type TestResult } from "./lib/engine";
import { judge, type Verdict } from "./lib/verdict";

/* ---- History (localStorage) ------------------------------------------------ */
type HistoryEntry = {
  ts: number;
  down: number;
  up: number;
  ping: number;
  bloat: number;
  grade: string;
  score: number;
  dataMB: number;
};

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
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, 50)));
  } catch {}
}

/* ---- App --------------------------------------------------------------------- */
const PHASE_LABEL: Record<Phase, string> = {
  idle: "Standing by",
  latency: "Probing idle latency",
  download: "Measuring download",
  upload: "Measuring upload",
  done: "Test complete",
  error: "Test failed",
};

export default function App() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [samples, setSamples] = useState<Sample[]>([]);
  const [live, setLive] = useState<Partial<TestResult>>({});
  const [result, setResult] = useState<TestResult | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [lowData, setLowData] = useState(false);
  const [liveMbps, setLiveMbps] = useState<number | null>(null);
  const runningRef = useRef(false);

  const running = phase === "latency" || phase === "download" || phase === "upload";

  const start = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setSamples([]);
    setLive({});
    setResult(null);
    setVerdict(null);
    setLiveMbps(null);
    try {
      const r = await runTest(
        { lowData },
        {
          onPhase: setPhase,
          onSample: (s) => {
            setSamples((prev) => [...prev, s]);
            if (s.mbps !== undefined) setLiveMbps(s.mbps);
          },
          onPartial: (p) => setLive((prev) => ({ ...prev, ...p })),
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

  // Big readout: live Mbps while loading, score when done.
  const readout =
    running && phase !== "latency"
      ? liveMbps !== null
        ? liveMbps >= 100
          ? String(Math.round(liveMbps))
          : liveMbps.toFixed(1)
        : "—"
      : result
        ? String(verdict?.score ?? "—")
        : "—";
  const readoutUnit = running && phase !== "latency" ? "Mbps" : result ? "/100" : "";

  return (
    <div className="app">
      <header className="topbar">
        <div className="wordmark">
          net<span>pulse</span>
          <em className="wordmark__tag">internet health console</em>
        </div>
        <div className="topbar__right">
          <label className="lowdata">
            <input
              type="checkbox"
              checked={lowData}
              onChange={(e) => setLowData(e.target.checked)}
              disabled={running}
            />
            low-data mode
          </label>
          {result && (
            <span className="datause" title="Data transferred by this test">
              {result.dataUsedMB.toFixed(0)} MB used
            </span>
          )}
        </div>
      </header>

      <main>
        {/* Console: readout + control */}
        <section className="console">
          <div className="console__readout">
            <div className="readout__value" data-running={running || undefined}>
              {readout}
              <span className="readout__unit">{readoutUnit}</span>
            </div>
            <div className="readout__phase">
              {running && <span className="pulse-dot" aria-hidden="true" />}
              {PHASE_LABEL[phase]}
              {result && verdict && <strong> — {verdict.headline}</strong>}
            </div>
          </div>
          <button className="runbtn" onClick={() => void start()} disabled={running}>
            {running ? "Testing…" : result ? "Run again" : "Run test"}
          </button>
        </section>

        {/* Signature scope */}
        <Scope samples={samples} running={running} />

        {/* Metric cards */}
        <section className="metrics">
          <Metric label="Download" value={live.downloadMbps} unit="Mbps" hot={phase === "download"} />
          <Metric label="Upload" value={live.uploadMbps} unit="Mbps" hot={phase === "upload"} />
          <Metric label="Idle ping" value={live.idlePingMs} unit="ms" precision={0} />
          <Metric
            label="Loaded ping"
            value={
              live.loadedUpPingMs !== undefined || live.loadedDownPingMs !== undefined
                ? Math.max(live.loadedDownPingMs ?? 0, live.loadedUpPingMs ?? 0)
                : undefined
            }
            unit="ms"
            precision={0}
          />
          <Metric label="Jitter" value={live.idleJitterMs} unit="ms" precision={1} />
          <div className="metric">
            <div className="metric__label">Bufferbloat</div>
            <div className="metric__value">
              {result ? (
                <span className={`bloat bloat--${result.bufferbloatGrade}`}>{result.bufferbloatGrade}</span>
              ) : (
                <span className="metric__idle">—</span>
              )}
            </div>
            <div className="metric__sub">
              {result ? `+${Math.round(result.bufferbloatMs)}ms under load` : "latency rise under load"}
            </div>
          </div>
        </section>

        {/* Verdict */}
        {verdict && result && (
          <section className="verdict">
            <div className="verdict__col">
              <h2 className="verdict__h">Real-world impact</h2>
              <div className="activities">
                {verdict.activities.map((a) => (
                  <div key={a.name} className="activity">
                    <span className={`grade grade--${a.grade.toLowerCase()}`}>{a.grade}</span>
                    <div>
                      <div className="activity__name">{a.name}</div>
                      <div className="activity__note">{a.note}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="verdict__col">
              <h2 className="verdict__h">Diagnosis</h2>
              {verdict.good.length > 0 && (
                <ul className="diag diag--good">
                  {verdict.good.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              )}
              {verdict.bad.length > 0 && (
                <ul className="diag diag--bad">
                  {verdict.bad.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              )}
              <h2 className="verdict__h">Next actions</h2>
              <ol className="actions">
                {verdict.actions.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
              {verdict.dontBuy && (
                <div className="dontbuy">
                  <span>Don't waste money on:</span> {verdict.dontBuy}
                </div>
              )}
            </div>
          </section>
        )}

        {/* History */}
        {history.length > 0 && (
          <section className="history">
            <div className="history__head">
              <h2 className="verdict__h">History</h2>
              <button
                className="history__clear"
                onClick={() => {
                  setHistory([]);
                  saveHistory([]);
                }}
              >
                clear
              </button>
            </div>
            <table>
              <thead>
                <tr>
                  <th>when</th>
                  <th>score</th>
                  <th>down</th>
                  <th>up</th>
                  <th>ping</th>
                  <th>bloat</th>
                  <th>data</th>
                </tr>
              </thead>
              <tbody>
                {history.slice(0, 12).map((h) => (
                  <tr key={h.ts}>
                    <td>{new Date(h.ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="num">{h.score}</td>
                    <td className="num">{h.down >= 100 ? Math.round(h.down) : h.down.toFixed(1)}</td>
                    <td className="num">{h.up >= 100 ? Math.round(h.up) : h.up.toFixed(1)}</td>
                    <td className="num">{Math.round(h.ping)}ms</td>
                    <td className="num">{h.grade}</td>
                    <td className="num">{h.dataMB.toFixed(0)}MB</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <footer className="foot">
          Tests run against Cloudflare's speed endpoints from your browser. A full test moves
          ~100–400&nbsp;MB depending on your speed — use low-data mode on metered connections.
        </footer>
      </main>
    </div>
  );
}

function Metric({
  label,
  value,
  unit,
  precision = 1,
  hot,
}: {
  label: string;
  value: number | undefined;
  unit: string;
  precision?: number;
  hot?: boolean;
}) {
  return (
    <div className="metric" data-hot={hot || undefined}>
      <div className="metric__label">{label}</div>
      <div className="metric__value">
        {value !== undefined ? (
          <>
            {value >= 100 ? Math.round(value) : value.toFixed(precision)}
            <span className="metric__unit">{unit}</span>
          </>
        ) : (
          <span className="metric__idle">—</span>
        )}
      </div>
    </div>
  );
}
