import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * NetPulse speedometer — side-by-side twins (Download | Upload).
 *
 * Why this is a single component driven imperatively:
 *
 *   The needle, progress arc, terminal dot, tick activation and the numeral all
 *   derive from ONE animated value + ONE scale. They cannot disagree.
 *
 *   Crucially, the animation loop mutates the SVG/DOM directly through refs and
 *   NEVER calls setState per frame. The previous version re-rendered React on
 *   every rAF tick — fine at 60 Hz, but on 120/144 Hz desktops it fired 2–2.4×
 *   the renders and the reconciliation cost made the needle stutter and
 *   "fluctuate". Driving the SVG imperatively is buttery at any refresh rate.
 *
 * Colour bands follow the measured value (not the fraction):
 *   < 100  blue · 100–200 yellow · 200–500 orange · ≥ 500 red.
 * The arc, needle, dot, active ticks and the number all share that one colour,
 * so colour and motion move together.
 *
 * Honesty: the spring only ever animates toward a real sample or the final
 * measured figure — nothing synthetic. On `done`, both gauges replay a
 * synchronized 0→final sweep (a results flourish over real numbers), which is
 * how download and upload "move together" without measuring them concurrently
 * (concurrent measurement would corrupt each direction's number).
 *
 * prefers-reduced-motion: values snap, nothing springs.
 */

const START = 135; // degrees at value 0
const SWEEP = 270; // degrees of travel
const CX = 100;
const CY = 100;
const R_RING = 87;
const R_ARC = 76;
const TICKS = 9;
const DEFAULT_SCALE = 240;
const SCALE_STEPS = [50, 100, 240, 500, 1000, 2500, 10000];

const polar = (deg: number, r: number): [number, number] => {
  const rad = (deg * Math.PI) / 180;
  return [CX + r * Math.cos(rad), CY + r * Math.sin(rad)];
};

const arcPath = (fromDeg: number, toDeg: number, r: number): string => {
  const [x1, y1] = polar(fromDeg, r);
  const [x2, y2] = polar(toDeg, r);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${toDeg - fromDeg > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
};

function scaleFor(peak: number): number {
  for (const m of SCALE_STEPS) if (peak <= m * 0.94) return m;
  return SCALE_STEPS[SCALE_STEPS.length - 1];
}

const fraction = (value: number, scale: number) => Math.max(0, Math.min(value / Math.max(scale, 1), 1));
const fmtScale = (n: number) => (n >= 1000 ? `${n / 1000}k` : String(Math.round(n)));
const fmtValue = (n: number) => (n >= 100 ? String(Math.round(n)) : n.toFixed(1));

/** Value → CSS variable name of its colour band. */
function band(v: number): string {
  if (v < 100) return "var(--g-blue)";
  if (v < 200) return "var(--g-yellow)";
  if (v < 500) return "var(--g-orange)";
  return "var(--g-red)";
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false),
  );
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

type Spring = { value: number; velocity: number; target: number };

export function Gauge({
  label,
  liveMbps,
  active,
  waiting,
  done,
  finalMbps,
}: {
  label: string;
  liveMbps: number | null;
  active: boolean;
  waiting: boolean;
  done: boolean;
  finalMbps: number | null;
}) {
  const reduced = useReducedMotion();

  // Element refs — the animation writes straight to these.
  const needleRef = useRef<SVGLineElement>(null);
  const arcRef = useRef<SVGPathElement>(null);
  const capRef = useRef<SVGCircleElement>(null);
  const numRef = useRef<HTMLSpanElement>(null);
  const tickRefs = useRef<(SVGLineElement | null)[]>([]);

  // Springs live in refs; render never reads them.
  const val = useRef<Spring>({ value: 0, velocity: 0, target: 0 });
  const scl = useRef<Spring>({ value: DEFAULT_SCALE, velocity: 0, target: DEFAULT_SCALE });
  const peak = useRef(0);
  const armedRef = useRef(false);
  const doneEdge = useRef(false);
  const lastTick = useRef(0);

  // Only rarely-changing things live in React state.
  const [labelScale, setLabelScale] = useState(DEFAULT_SCALE);
  const hasMeasured = liveMbps !== null || (done && finalMbps !== null);
  const idle = !active && !done && !hasMeasured;

  /* Reset on the rising edge of a new run. */
  const armed = waiting && !active && !done;
  useEffect(() => {
    if (armed && !armedRef.current) {
      peak.current = 0;
      val.current = { value: 0, velocity: 0, target: 0 };
      scl.current = { value: DEFAULT_SCALE, velocity: 0, target: DEFAULT_SCALE };
      setLabelScale(DEFAULT_SCALE);
    }
    armedRef.current = armed;
  }, [armed]);

  /* Retarget from real values only. */
  useEffect(() => {
    const v = val.current;
    if (done && finalMbps !== null) v.target = finalMbps;
    else if (liveMbps !== null) v.target = liveMbps;
    else v.target = 0;

    if (v.target > peak.current) {
      peak.current = v.target;
      scl.current.target = scaleFor(peak.current);
      setLabelScale(scl.current.target);
    }
  }, [liveMbps, active, done, finalMbps]);

  /* Synchronized reveal: when the whole test finishes, replay a 0→final sweep.
     Both gauges get `done` on the same commit, so both sweep together. */
  useEffect(() => {
    if (done && finalMbps !== null && !doneEdge.current) {
      doneEdge.current = true;
      const s = scaleFor(finalMbps);
      peak.current = finalMbps;
      scl.current = { value: s, velocity: 0, target: s }; // fix scale so the sweep maps cleanly
      setLabelScale(s);
      if (!reduced) {
        val.current.value = 0;
        val.current.velocity = 0;
      }
      val.current.target = finalMbps;
    }
    if (!done) doneEdge.current = false;
  }, [done, finalMbps, reduced]);

  /* Paint one frame straight to the DOM. */
  const paint = (value: number, scale: number) => {
    const frac = fraction(value, scale);
    const angle = START + frac * SWEEP;
    const colour = idleColourRef.current ? "var(--np-muted)" : band(value);

    if (needleRef.current) {
      const [x1, y1] = polar(angle, R_ARC - 26);
      const [x2, y2] = polar(angle, R_RING - 3);
      needleRef.current.setAttribute("x1", x1.toFixed(2));
      needleRef.current.setAttribute("y1", y1.toFixed(2));
      needleRef.current.setAttribute("x2", x2.toFixed(2));
      needleRef.current.setAttribute("y2", y2.toFixed(2));
      needleRef.current.style.stroke = colour;
    }
    if (arcRef.current) {
      const show = frac > 0.004;
      arcRef.current.style.opacity = show ? "1" : "0";
      if (show) {
        arcRef.current.setAttribute("d", arcPath(START, angle, R_ARC));
        arcRef.current.style.stroke = colour;
      }
    }
    if (capRef.current) {
      const show = frac > 0.004;
      capRef.current.style.opacity = show ? "1" : "0";
      if (show) {
        const [dx, dy] = polar(angle, R_ARC);
        capRef.current.setAttribute("cx", dx.toFixed(2));
        capRef.current.setAttribute("cy", dy.toFixed(2));
        capRef.current.style.fill = colour;
      }
    }
    for (let i = 0; i < tickRefs.current.length; i++) {
      const el = tickRefs.current[i];
      if (!el) continue;
      const t = i / (TICKS - 1);
      el.style.stroke = frac >= t - 0.001 && !idleColourRef.current ? colour : "";
    }
    if (numRef.current) {
      numRef.current.textContent =
        waitingRef.current && !activeRef.current && !hasMeasuredRef.current ? "···" : fmtValue(value);
      numRef.current.style.color = idleColourRef.current ? "var(--np-muted)" : "var(--foreground)";
    }
  };

  // Mirror a few render-time booleans into refs so `paint` (called from rAF) reads fresh values.
  const idleColourRef = useRef(idle);
  const hasMeasuredRef = useRef(hasMeasured);
  const waitingRef = useRef(waiting);
  const activeRef = useRef(active);
  useLayoutEffect(() => {
    idleColourRef.current = idle;
    hasMeasuredRef.current = hasMeasured;
    waitingRef.current = waiting;
    activeRef.current = active;
  });

  /* Reduced motion: snap on every relevant change, no loop. */
  useLayoutEffect(() => {
    if (!reduced) return;
    val.current.value = val.current.target;
    scl.current.value = scl.current.target;
    paint(val.current.target, scl.current.target);
     
  }, [reduced, liveMbps, active, done, finalMbps, waiting]);

  /* The single animation loop — imperative, no React state per frame. */
  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    let last = performance.now();
    const stepSpring = (s: Spring, dt: number, k: number, c: number) => {
      const a = (s.target - s.value) * k - s.velocity * c;
      s.velocity += a * dt;
      s.value = Math.max(0, s.value + s.velocity * dt);
      return Math.abs(s.target - s.value) > 0.01 || Math.abs(s.velocity) > 0.01;
    };
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      lastTick.current = now;
      const movingV = stepSpring(val.current, dt, 46, 11);
      const movingS = stepSpring(scl.current, dt, 16, 8);
      if (!movingV && val.current.value !== val.current.target) {
        val.current.value = val.current.target;
        val.current.velocity = 0;
      }
      if (!movingS) scl.current.value = scl.current.target;
      paint(val.current.value, scl.current.value);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
     
  }, [reduced]);

  /* Background tabs suspend rAF — snap on return. */
  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => {
      if (performance.now() - lastTick.current < 400) return;
      if (Math.abs(val.current.target - val.current.value) < 0.01) return;
      val.current.value = val.current.target;
      val.current.velocity = 0;
      scl.current.value = scl.current.target;
      paint(val.current.value, scl.current.value);
    }, 300);
    return () => clearInterval(id);
     
  }, [reduced]);

  const status =
    done && finalMbps !== null
      ? `${fmtValue(finalMbps)} megabits per second`
      : active
        ? "measuring"
        : hasMeasured
          ? "measured"
          : "not yet measured";

  return (
    <figure className="np-gauge" role="img" aria-label={`${label}: ${status}`}>
      <svg viewBox="0 0 200 200" className="np-gauge__svg" aria-hidden="true">
        {/* track + ring */}
        <path d={arcPath(START, START + SWEEP, R_ARC)} className="np-gauge__track" />
        <path d={arcPath(START, START + SWEEP, R_RING)} className="np-gauge__ring" />

        {/* ticks */}
        {Array.from({ length: TICKS }, (_, i) => {
          const t = i / (TICKS - 1);
          const d = START + t * SWEEP;
          const major = i % 4 === 0;
          const [tx1, ty1] = polar(d, R_RING - (major ? 8 : 4.5));
          const [tx2, ty2] = polar(d, R_RING + 1);
          return (
            <line
              key={i}
              ref={(el) => {
                tickRefs.current[i] = el;
              }}
              x1={tx1}
              y1={ty1}
              x2={tx2}
              y2={ty2}
              className={major ? "np-gauge__tick--major" : "np-gauge__tick"}
            />
          );
        })}

        {/* progress arc + terminal dot (positioned/coloured imperatively) */}
        <path ref={arcRef} className="np-gauge__sweep" style={{ opacity: 0 }} />
        <circle ref={capRef} r="5" className="np-gauge__cap" style={{ opacity: 0 }} />

        {/* needle (no central hub — kept clear of the number) */}
        <line ref={needleRef} className="np-gauge__needle" />
      </svg>

      <span className="np-gauge__scale np-gauge__scale--zero">0</span>
      <span className="np-gauge__scale np-gauge__scale--mid">{fmtScale(labelScale / 2)}</span>
      <span className="np-gauge__scale np-gauge__scale--max">{fmtScale(labelScale)}</span>

      <figcaption className="np-gauge__center">
        <span className="np-gauge__label">{label}</span>
        <span className="np-gauge__value" ref={numRef} data-idle={idle || undefined}>
          {idle ? "0.0" : ""}
        </span>
        <span className="np-gauge__unit">MBPS</span>
      </figcaption>
    </figure>
  );
}
