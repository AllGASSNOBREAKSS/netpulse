import { useEffect, useRef, useState } from "react";
import type { Phase } from "../lib/engine";

/**
 * Automotive-cluster speedometer.
 *
 * A 270° dial (0 at lower-left, mid at top, max at lower-right) with a blue
 * progress sweep, a fixed redline zone, and a needle driven by spring physics
 * so live throughput samples feel like an engine revving — overshoot, settle,
 * surge. The center numeral is the live measured Mbps; nothing is synthetic.
 */

const START_DEG = 135; // dial zero
const SWEEP_DEG = 270; // total sweep
const CX = 200;
const CY = 200;
const R_RING = 172;
const R_ARC = 158;

function polar(deg: number, r: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [CX + r * Math.cos(rad), CY + r * Math.sin(rad)];
}

function arcPath(fromDeg: number, toDeg: number, r: number): string {
  const [x1, y1] = polar(fromDeg, r);
  const [x2, y2] = polar(toDeg, r);
  const large = toDeg - fromDeg > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}

/** Pick a dial max that keeps the needle in a useful range. */
export function dialMax(peak: number): number {
  for (const m of [100, 240, 500, 1000, 2500, 10000]) {
    if (peak <= m * 0.96) return m;
  }
  return 10000;
}

export default function Speedometer({
  liveMbps,
  phase,
  idlePingMs,
  dataUsedMB,
  finalScore,
}: {
  liveMbps: number | null;
  phase: Phase;
  idlePingMs: number | undefined;
  dataUsedMB: number;
  finalScore: number | null;
}) {
  const [display, setDisplay] = useState(0);
  const [max, setMax] = useState(240);
  const physics = useRef({ value: 0, velocity: 0, target: 0 });
  const peakRef = useRef(0);
  const lastTickRef = useRef(0);

  // Feed the spring's target from live samples.
  useEffect(() => {
    const p = physics.current;
    if (liveMbps !== null && (phase === "download" || phase === "upload")) {
      p.target = liveMbps;
    } else if (phase === "done" || phase === "idle" || phase === "error") {
      p.target = liveMbps ?? 0;
    } else {
      p.target = 0; // latency phase: needle rests
    }
    // Keep the dial scale ahead of whatever the needle is chasing.
    if (p.target > peakRef.current) {
      peakRef.current = p.target;
      setMax(dialMax(peakRef.current));
    }
  }, [liveMbps, phase]);

  // Watchdog: rAF is throttled or suspended in background tabs. Whenever the
  // spring loop stops ticking, snap the dial straight to its target so it
  // never shows a stale value.
  useEffect(() => {
    const watchdog = setInterval(() => {
      const p = physics.current;
      if (performance.now() - lastTickRef.current > 400 && Math.abs(p.target - p.value) > 0.01) {
        p.value = p.target;
        p.velocity = 0;
        setDisplay(p.target);
      }
    }, 300);
    return () => clearInterval(watchdog);
  }, []);

  // Reset between runs.
  useEffect(() => {
    if (phase === "latency") {
      peakRef.current = 0;
      setMax(240);
      physics.current.target = 0;
    }
  }, [phase]);

  // Spring loop — stiff enough to chase samples, soft enough to overshoot
  // like a rev counter.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const p = physics.current;
      const stiffness = 42;
      const damping = 9;
      const accel = (p.target - p.value) * stiffness - p.velocity * damping;
      p.velocity += accel * dt;
      p.value = Math.max(0, p.value + p.velocity * dt);
      lastTickRef.current = now;
      // Only re-render while the needle is actually moving — at rest the
      // loop idles without touching React state.
      if (Math.abs(p.target - p.value) > 0.01 || Math.abs(p.velocity) > 0.01) {
        setDisplay(p.value);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const frac = Math.min(display / max, 1);
  const needleDeg = START_DEG + frac * SWEEP_DEG;
  const [nx1, ny1] = polar(needleDeg, R_ARC - 30);
  const [nx2, ny2] = polar(needleDeg, R_RING - 4);

  const isLoading = phase === "download" || phase === "upload";
  // Once the test is done the numeral is the measured result, straight from
  // the engine — the spring only drives the needle's settle animation.
  const shown = phase === "done" ? (liveMbps ?? display) : isLoading ? display : 0;
  const numeral =
    phase === "latency"
      ? "···"
      : shown >= 100
        ? String(Math.round(shown))
        : shown.toFixed(1);

  const gear =
    phase === "download" ? "D3" : phase === "upload" ? "U2" : phase === "latency" ? "P" : phase === "done" ? "N" : "—";

  // Redline: top 8% of the dial.
  const redFrom = START_DEG + SWEEP_DEG * 0.92;

  // Data bar: relative to a ~400 MB full test.
  const dataFrac = Math.min(dataUsedMB / 400, 1);

  return (
    <div className="speedo">
      <svg viewBox="0 0 400 400" className="speedo__dial" aria-hidden="true">
        <defs>
          <linearGradient id="sweep" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stopColor="#1d4ed8" />
            <stop offset="100%" stopColor="#60a5fa" />
          </linearGradient>
        </defs>

        {/* outer thin ring */}
        <path d={arcPath(START_DEG, START_DEG + SWEEP_DEG, R_RING)} className="speedo__ring" />

        {/* redline zone */}
        <path d={arcPath(redFrom, START_DEG + SWEEP_DEG, R_RING)} className="speedo__redline" />

        {/* live sweep */}
        {frac > 0.005 && (
          <path
            d={arcPath(START_DEG, START_DEG + frac * SWEEP_DEG, R_ARC)}
            className="speedo__sweep"
            stroke="url(#sweep)"
          />
        )}

        {/* needle */}
        <line x1={nx1} y1={ny1} x2={nx2} y2={ny2} className="speedo__needle" />

        {/* major ticks */}
        {[0, 0.5, 1].map((f) => {
          const d = START_DEG + f * SWEEP_DEG;
          const [tx1, ty1] = polar(d, R_RING - 8);
          const [tx2, ty2] = polar(d, R_RING + 2);
          return <line key={f} x1={tx1} y1={ty1} x2={tx2} y2={ty2} className="speedo__tick" />;
        })}
      </svg>

      {/* dial labels */}
      <span className="speedo__scale speedo__scale--zero">0</span>
      <span className="speedo__scale speedo__scale--mid">{max / 2}</span>
      <span className="speedo__scale speedo__scale--max">{max}</span>

      {/* center cluster */}
      <div className="speedo__center">
        <div className="speedo__row">
          {idlePingMs !== undefined ? (
            <span className="speedo__limit" title="Idle ping (ms)">
              {Math.round(idlePingMs)}
            </span>
          ) : (
            <span className="speedo__limit speedo__limit--empty" />
          )}
          <span className="speedo__value">{numeral}</span>
          <span className="speedo__gear" title="Test phase">
            {gear}
          </span>
        </div>
        <div className="speedo__unit">MBPS</div>
        {finalScore !== null && phase === "done" && (
          <div className="speedo__score">health {finalScore}/100</div>
        )}
      </div>

      {/* data-used fuel bar */}
      <div className="speedo__fuel" title="Data used by this test">
        <span className="speedo__fuel-icon">▮▯</span>
        <span className="speedo__fuel-track">
          <span className="speedo__fuel-fill" style={{ width: `${Math.max(dataFrac * 100, 2)}%` }} />
        </span>
        <span className="speedo__fuel-label">{dataUsedMB.toFixed(0)} MB</span>
      </div>
    </div>
  );
}
