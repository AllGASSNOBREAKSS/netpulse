import { useCallback, useRef, useState } from "react";
import Speedometer from "./components/Speedometer";
import { ConnectionPrivacy, Devices, LatencyMonitor } from "./components/Panels";
import { MetricDetail, ScoreDetail } from "./components/MetricDetail";
import { runTest, type Phase, type TestResult } from "./lib/engine";
import { METRICS } from "./lib/metrics";
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
const SIDEBAR_KEY = "netpulse_sidebar";

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
type View = "speed" | "latency" | "devices" | "privacy" | "history";

const NAV: { view: View; label: string; icon: JSX.Element }[] = [
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
    view: "devices",
    label: "Devices",
    icon: (
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="8" cy="12.5" r="1.2" fill="currentColor" stroke="none" />
        <path d="M4.5 9.5a5 5 0 0 1 7 0M2 7a8.5 8.5 0 0 1 12 0" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    view: "privacy",
    label: "Connection & Privacy",
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
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_KEY) === "1");
  const [phase, setPhase] = useState<Phase>("idle");
  const [live, setLive] = useState<Partial<TestResult>>({});
  const [result, setResult] = useState<TestResult | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [lowData, setLowData] = useState(false);
  const [liveMbps, setLiveMbps] = useState<number | null>(null);
  const [dataMB, setDataMB] = useState(0);
  const [openMetric, setOpenMetric] = useState<string | null>(null);
  const [showScore, setShowScore] = useState(false);
  const runningRef = useRef(false);
  const dataRef = useRef(0);

  const running = phase === "latency" || phase === "download" || phase === "upload";

  const toggleSidebar = useCallback(() => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, c ? "0" : "1");
      } catch {}
      return !c;
    });
  }, []);

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

  const openDef = openMetric ? METRICS.find((m) => m.id === openMetric) : null;

  return (
    <div className="app" data-collapsed={collapsed || undefined}>
      {/* ---- Sidebar ---- */}
      <aside className="sidebar">
        <div className="sidebar__top">
          <div className="brand">
            <span className="brand__full">
              net<span className="brand__accent">pulse</span>
            </span>
            <span className="brand__mini" aria-hidden="true">
              n<span className="brand__accent">p</span>
            </span>
            <em className="brand__tag">internet health console</em>
          </div>
          <button
            className="collapse-btn"
            onClick={toggleSidebar}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              {collapsed ? (
                <path d="M6 3.5 10.5 8 6 12.5" strokeLinecap="round" strokeLinejoin="round" />
              ) : (
                <path d="M10 3.5 5.5 8 10 12.5" strokeLinecap="round" strokeLinejoin="round" />
              )}
            </svg>
          </button>
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
          <label className="lowdata" title="Cap the test at ~35 MB for metered connections">
            <input
              type="checkbox"
              checked={lowData}
              onChange={(e) => setLowData(e.target.checked)}
              disabled={running}
            />
            <span className="lowdata__text">low-data mode</span>
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
                lowData={lowData}
                onScoreClick={() => setShowScore(true)}
              />
              <div className="stage__status" role="status">
                {running && <span className="pulse-dot" aria-hidden="true" />}
                {PHASE_LABEL[phase]}
                {result && verdict && <strong> — {verdict.headline}</strong>}
              </div>
              <button className="runbtn" onClick={() => void start()} disabled={running}>
                {running ? "Testing…" : result ? "Run again" : "Start"}
              </button>
            </section>

            <p className="metrics__hint">Click any metric to see what it means and how it was measured.</p>
            <section className="metrics">
              {METRICS.map((m) => {
                const v = m.value(result ?? live);
                const sub = m.sub ? m.sub(result ?? live) : null;
                return (
                  <button
                    key={m.id}
                    className="metric"
                    data-hot={(running && m.hotPhase === phase) || undefined}
                    data-na={m.unavailable ? true : undefined}
                    onClick={() => setOpenMetric(m.id)}
                  >
                    <div className="metric__label">{m.name}</div>
                    <div className="metric__value">
                      {m.unavailable ? (
                        <span className="metric__na">n/a</span>
                      ) : v !== null ? (
                        v
                      ) : (
                        <span className="metric__idle">—</span>
                      )}
                    </div>
                    <div className="metric__sub">{m.unavailable ? "not measurable in-browser" : sub ?? " "}</div>
                  </button>
                );
              })}
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
              Speed and latency are measured live against Cloudflare's speed endpoints from your
              browser. Packet loss can't be measured reliably by a web page, so NetPulse doesn't
              show it. Results depend on your device and the network path to the test server.
            </footer>
          </>
        )}

        {view === "latency" && <LatencyMonitor />}
        {view === "devices" && <Devices />}
        {view === "privacy" && <ConnectionPrivacy />}

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

      {/* ---- Detail panels ---- */}
      {openDef && <MetricDetail def={openDef} result={result} onClose={() => setOpenMetric(null)} />}
      {showScore && verdict && (
        <ScoreDetail score={verdict.score} parts={verdict.breakdown} onClose={() => setShowScore(false)} />
      )}
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
    <button
      className="nav__item"
      data-active={active || undefined}
      onClick={() => onSelect(item.view)}
      title={item.label}
    >
      <span className="nav__icon">{item.icon}</span>
      <span className="nav__text">{item.label}</span>
    </button>
  );
}
