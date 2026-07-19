import { useCallback, useRef, useState } from "react";
import Speedometer from "./components/Speedometer";
import { Connections, LatencyMonitor, Vulnerabilities } from "./components/Panels";
import { runTest, type Phase, type TestResult } from "./lib/engine";
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

/* ---- Navigation ------------------------------------------------------------ */
type View = "speed" | "latency" | "connections" | "vulns" | "history";

const NAV: { view: View; label: string; icon: JSX.Element; soon?: boolean }[] = [
  {
    view: "speed",
    label: "Speed test",
    icon: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M2.5 11.5a6 6 0 1 1 11 0" strokeLinecap="round" />
        <path d="M8 9.5 10.8 6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    view: "latency",
    label: "Latency monitor",
    icon: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M1.5 8h3l2-4 3 8 2-4h3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    view: "connections",
    label: "Connections",
    icon: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="8" cy="12.5" r="1.2" fill="currentColor" stroke="none" />
        <path d="M4.5 9.5a5 5 0 0 1 7 0M2 7a8.5 8.5 0 0 1 12 0" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    view: "vulns",
    label: "Vulnerabilities",
    icon: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M8 1.5 13.5 4v4c0 3.2-2.3 5.6-5.5 6.5C4.8 13.6 2.5 11.2 2.5 8V4L8 1.5Z" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    view: "history",
    label: "History",
    icon: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="8" cy="8" r="6" />
        <path d="M8 4.5V8l2.5 1.5" strokeLinecap="round" />
      </svg>
    ),
  },
];

const PHASE_LABEL: Record<Phase, string> = {
  idle: "Ready when you are",
  latency: "Probing idle latency",
  download: "Measuring download",
  upload: "Measuring upload",
  done: "Test complete",
  error: "Test failed — check your connection and retry",
};

/* ---- App ------------------------------------------------------------------- */
export default function App() {
  const [view, setView] = useState<View>("speed");
  const [phase, setPhase] = useState<Phase>("idle");
  const [live, setLive] = useState<Partial<TestResult>>({});
  const [result, setResult] = useState<TestResult | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [lowData, setLowData] = useState(false);
  const [liveMbps, setLiveMbps] = useState<number | null>(null);
  const [dataMB, setDataMB] = useState(0);
  const runningRef = useRef(false);
  const dataRef = useRef(0);

  const running = phase === "latency" || phase === "download" || phase === "upload";

  const start = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setLive({});
    setResult(null);
    setVerdict(null);
    setLiveMbps(null);
    dataRef.current = 0;
    setDataMB(0);
    try {
      const r = await runTest(
        { lowData },
        {
          onPhase: setPhase,
          onSample: (s) => {
            if (s.mbps !== undefined) {
              setLiveMbps(s.mbps);
              // each throughput sample covers a 250ms window → Mbps/32 = MB moved
              dataRef.current += s.mbps / 32;
              setDataMB(dataRef.current);
            }
          },
          onPartial: (p) => setLive((prev) => ({ ...prev, ...p })),
        },
      );
      setResult(r);
      setLiveMbps(r.downloadMbps); // needle settles on the download result
      setDataMB(r.dataUsedMB); // exact byte count from the engine
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

  return (
    <div className="app">
      {/* ---- Sidebar ---- */}
      <aside className="sidebar">
        <div className="brand">
          net<span>pulse</span>
          <em className="brand__tag">internet health console</em>
        </div>

        <nav className="nav">
          <div className="nav__label">Diagnostics</div>
          {NAV.slice(0, 2).map((n) => (
            <NavItem key={n.view} item={n} active={view === n.view} onSelect={setView} />
          ))}
          <div className="nav__label">Network</div>
          {NAV.slice(2, 4).map((n) => (
            <NavItem key={n.view} item={n} active={view === n.view} onSelect={setView} />
          ))}
          <div className="nav__label">Records</div>
          {NAV.slice(4).map((n) => (
            <NavItem key={n.view} item={n} active={view === n.view} onSelect={setView} />
          ))}
        </nav>

        <div className="sidebar__foot">
          <label className="lowdata">
            <input
              type="checkbox"
              checked={lowData}
              onChange={(e) => setLowData(e.target.checked)}
              disabled={running}
            />
            low-data mode
          </label>
          <div className="sidebar__note">
            Full test moves ~100–400&nbsp;MB.
            <br />
            Low-data caps it at ~35&nbsp;MB.
          </div>
        </div>
      </aside>

      {/* ---- Main ---- */}
      <main className="main">
        {view === "speed" && (
          <>
            <section className="stage">
              <Speedometer
                liveMbps={liveMbps}
                phase={phase}
                idlePingMs={live.idlePingMs}
                dataUsedMB={dataMB}
                finalScore={verdict?.score ?? null}
              />
              <div className="stage__status">
                {running && <span className="pulse-dot" aria-hidden="true" />}
                {PHASE_LABEL[phase]}
                {result && verdict && <strong> — {verdict.headline}</strong>}
              </div>
              <button className="runbtn" onClick={() => void start()} disabled={running}>
                {running ? "Testing…" : result ? "Run again" : "Start"}
              </button>
            </section>

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

            <footer className="foot">
              Tests run against Cloudflare's speed endpoints from your browser — every number on
              the dial is measured, never simulated.
            </footer>
          </>
        )}

        {view === "latency" && <LatencyMonitor />}
        {view === "connections" && <Connections />}
        {view === "vulns" && <Vulnerabilities />}

        {view === "history" && (
          <div className="panel">
            <div className="panel__head">
              <div>
                <h1 className="panel__title">Test history</h1>
                <p className="panel__sub">Every result stays on this device — nothing is uploaded.</p>
              </div>
              {history.length > 0 && (
                <button
                  className="history__clear"
                  onClick={() => {
                    setHistory([]);
                    saveHistory([]);
                  }}
                >
                  clear all
                </button>
              )}
            </div>
            {history.length === 0 ? (
              <p className="panel__note">No tests yet — run one from the Speed test tab.</p>
            ) : (
              <table className="history-table">
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
                  {history.slice(0, 20).map((h) => (
                    <tr key={h.ts}>
                      <td>
                        {new Date(h.ts).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
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
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function NavItem({
  item,
  active,
  onSelect,
}: {
  item: (typeof NAV)[number];
  active: boolean;
  onSelect: (v: View) => void;
}) {
  return (
    <button className="nav__item" data-active={active || undefined} onClick={() => onSelect(item.view)}>
      <span className="nav__icon">{item.icon}</span>
      {item.label}
    </button>
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
