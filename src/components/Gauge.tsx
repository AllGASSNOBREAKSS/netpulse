import { useEffect, useRef, useState } from "react";

/**
 * NetPulse speedometer, built for side-by-side twins (Download | Upload).
 *
 * Synchronisation contract — the reason this component exists in one piece:
 *
 *   ONE animated value (`display`) and ONE scale (`display / scale` -> angle)
 *   feed the needle, the progress arc, the tick activation and the numeral.
 *   None of them can disagree, lag, or land on a different number, because
 *   there is no second source of truth to drift from.
 *
 * The dial max is animated too. It used to snap (240 -> 500) the instant a
 * sample exceeded the current scale, which threw the needle *backwards* while
 * the value was still rising. Springing the scale keeps the needle monotonic.
 *
 * Honesty rules:
 *   - The spring only ever animates toward a real measured sample or the final
 *     measured figure. Nothing synthetic is ever injected.
 *   - At rest the numeral is snapped to the measured figure exactly, so the
 *     number you read is the number that was measured.
 *   - A gauge that has already measured HOLDS its value for the rest of the
 *     run. Download no longer falls to zero while upload is measuring.
 *
 * prefers-reduced-motion is honoured live (listener, not a one-shot read):
 * values snap, nothing springs.
 */

const START = 135; // degrees at value 0
const SWEEP = 270; // degrees of travel
const CX = 100;
const CY = 100;
const R_RING = 87;
const R_ARC = 76;
const TICKS = 9; // inclusive of both ends
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

/** Smallest scale step that keeps `peak` inside the dial with headroom. */
function scaleFor(peak: number): number {
  for (const m of SCALE_STEPS) if (peak <= m * 0.94) return m;
  return SCALE_STEPS[SCALE_STEPS.length - 1];
}

/** THE scale function. Everything visual derives from this one mapping. */
const fraction = (value: number, scale: number) =>
  Math.max(0, Math.min(value / Math.max(scale, 1), 1));

const fmtScale = (n: number) => (n >= 1000 ? `${n / 1000}k` : String(Math.round(n)));
const fmtValue = (n: number) => (n >= 100 ? String(Math.round(n)) : n.toFixed(1));

/** Live prefers-reduced-motion, so the setting can be changed mid-session. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false),
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
  /** Latest real throughput sample while this gauge's phase runs. */
  liveMbps: number | null;
  /** This gauge's measurement phase is running now. */
  active: boolean;
  /** A test is running but hasn't reached this gauge's phase yet. */
  waiting: boolean;
  /** Test finished. */
  done: boolean;
  /** Final measured figure (authoritative once done). */
  finalMbps: number | null;
}) {
  const reduced = useReducedMotion();

  // The single animated pair: the value on the dial, and the dial's own scale.
  const [frame, setFrame] = useState({ value: 0, scale: DEFAULT_SCALE });
  const val = useRef<Spring>({ value: 0, velocity: 0, target: 0 });
  const scl = useRef<Spring>({ value: DEFAULT_SCALE, velocity: 0, target: DEFAULT_SCALE });

  const peak = useRef(0);
  const armedRef = useRef(false);
  const lastTick = useRef(0);

  // The dial's settled scale, mirrored into state because the tick labels are
  // painted from it. Refs drive the animation; nothing is read from a ref
  // during render.
  const [labelScale, setLabelScale] = useState(DEFAULT_SCALE);

  /** This gauge has a real measurement in this run. Derived, never stored. */
  const hasMeasured = liveMbps !== null || (done && finalMbps !== null);

  /* Reset on the rising edge of a new run (this gauge is queued but not yet
     measuring). Holding this to the *edge* is what stops the reset from firing
     again later in the same run. */
  const armed = waiting && !active && !done;
  useEffect(() => {
    if (armed && !armedRef.current) {
      peak.current = 0;
      val.current = { value: 0, velocity: 0, target: 0 };
      scl.current = { value: DEFAULT_SCALE, velocity: 0, target: DEFAULT_SCALE };
      setFrame({ value: 0, scale: DEFAULT_SCALE });
      setLabelScale(DEFAULT_SCALE);
    }
    armedRef.current = armed;
  }, [armed]);

  /* Retarget from real values only. */
  useEffect(() => {
    const v = val.current;

    if (done && finalMbps !== null) {
      v.target = finalMbps;
    } else if (liveMbps !== null) {
      // Also covers the HOLD case: App clears liveDown/liveUp only when a new
      // run starts, so a gauge that has finished its phase keeps targeting its
      // last real sample instead of falling back to zero while the other gauge
      // measures.
      v.target = liveMbps;
    } else {
      v.target = 0;
    }

    if (v.target > peak.current) {
      peak.current = v.target;
      scl.current.target = scaleFor(peak.current);
      setLabelScale(scl.current.target);
    }

    if (reduced) {
      v.value = v.target;
      v.velocity = 0;
      scl.current.value = scl.current.target;
      scl.current.velocity = 0;
      setFrame({ value: v.target, scale: scl.current.target });
    }
  }, [liveMbps, active, done, finalMbps, reduced]);

  /* The one animation loop. Value and scale advance on the same frame, so the
     needle angle they jointly produce is always internally consistent. */
  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    let last = performance.now();

    const step = (s: Spring, dt: number, stiffness: number, damping: number) => {
      const accel = (s.target - s.value) * stiffness - s.velocity * damping;
      s.velocity += accel * dt;
      s.value = Math.max(0, s.value + s.velocity * dt);
      return Math.abs(s.target - s.value) > 0.01 || Math.abs(s.velocity) > 0.01;
    };

    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      lastTick.current = now;

      const movingValue = step(val.current, dt, 42, 9);
      // The scale is deliberately slower and heavier: it should glide under the
      // needle rather than race it.
      const movingScale = step(scl.current, dt, 14, 7);

      if (movingValue || movingScale) {
        setFrame({ value: val.current.value, scale: scl.current.value });
      } else if (val.current.value !== val.current.target) {
        // Settled: snap to the measured figure exactly.
        val.current.value = val.current.target;
        val.current.velocity = 0;
        scl.current.value = scl.current.target;
        setFrame({ value: val.current.target, scale: scl.current.target });
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  /* Background tabs suspend rAF — snap so the dial is never stale on return. */
  useEffect(() => {
    if (reduced) return;
    const watchdog = setInterval(() => {
      if (performance.now() - lastTick.current < 400) return;
      const v = val.current;
      if (Math.abs(v.target - v.value) < 0.01) return;
      v.value = v.target;
      v.velocity = 0;
      scl.current.value = scl.current.target;
      scl.current.velocity = 0;
      setFrame({ value: v.target, scale: scl.current.target });
    }, 300);
    return () => clearInterval(watchdog);
  }, [reduced]);

  /* ---------------- Everything below derives from ONE (value, scale) ------- */

  const frac = fraction(frame.value, frame.scale);
  const angle = START + frac * SWEEP;
  const [nx1, ny1] = polar(angle, R_ARC - 26);
  const [nx2, ny2] = polar(angle, R_RING - 3);
  const [dotX, dotY] = polar(angle, R_ARC);

  const idle = !active && !done && !hasMeasured;
  const numeral = waiting && !active && !hasMeasured ? "···" : fmtValue(frame.value);
  const gradId = `np-gauge-grad-${label.toLowerCase().replace(/\s+/g, "-")}`;

  const status =
    done && finalMbps !== null
      ? `${fmtValue(finalMbps)} megabits per second`
      : active
        ? "measuring"
        : hasMeasured
          ? `${fmtValue(frame.value)} megabits per second`
          : "not yet measured";

  return (
    <figure className="np-gauge" role="img" aria-label={`${label}: ${status}`}>
      <svg viewBox="0 0 200 200" className="np-gauge__svg" aria-hidden="true">
        <defs>
          <linearGradient id={gradId} x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.6" />
            <stop offset="100%" stopColor="var(--primary)" />
          </linearGradient>
        </defs>

        {/* track + ring */}
        <path d={arcPath(START, START + SWEEP, R_ARC)} className="np-gauge__track" />
        <path d={arcPath(START, START + SWEEP, R_RING)} className="np-gauge__ring" />

        {/* ticks — activation shares the needle's fraction, so a tick lights up
            at exactly the moment the needle passes it */}
        {Array.from({ length: TICKS }, (_, i) => {
          const t = i / (TICKS - 1);
          const d = START + t * SWEEP;
          const major = i % 4 === 0;
          const on = frac >= t - 0.001 && !idle;
          const [tx1, ty1] = polar(d, R_RING - (major ? 8 : 4.5));
          const [tx2, ty2] = polar(d, R_RING + 1);
          return (
            <line
              key={i}
              x1={tx1}
              y1={ty1}
              x2={tx2}
              y2={ty2}
              className={major ? "np-gauge__tick--major" : "np-gauge__tick"}
              data-on={on || undefined}
            />
          );
        })}

        {/* progress arc — butt caps + terminal dot keeps the visible tip exactly
            under the needle (round caps overshoot by half the stroke width) */}
        {frac > 0.004 && (
          <>
            <path d={arcPath(START, angle, R_ARC)} className="np-gauge__sweep" stroke={`url(#${gradId})`} />
            <circle cx={dotX} cy={dotY} r="5" className="np-gauge__cap" />
          </>
        )}

        {/* needle */}
        <line x1={nx1} y1={ny1} x2={nx2} y2={ny2} className="np-gauge__needle" />
        <circle cx={CX} cy={CY} r="3" className="np-gauge__hub" />
      </svg>

      {/* scale labels */}
      <span className="np-gauge__scale np-gauge__scale--zero">0</span>
      <span className="np-gauge__scale np-gauge__scale--mid">{fmtScale(labelScale / 2)}</span>
      <span className="np-gauge__scale np-gauge__scale--max">{fmtScale(labelScale)}</span>

      {/* center cluster */}
      <figcaption className="np-gauge__center">
        <span className="np-gauge__label">{label}</span>
        <span className="np-gauge__value" data-idle={idle || undefined}>
          {numeral}
        </span>
        <span className="np-gauge__unit">MBPS</span>
      </figcaption>
    </figure>
  );
}
