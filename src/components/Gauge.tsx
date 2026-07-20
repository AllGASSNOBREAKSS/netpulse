import { useEffect, useRef, useState } from "react";

/**
 * Automotive gauge, built for side-by-side twins (Download | Upload).
 *
 * Accuracy rules:
 * - Needle, progress arc, and numeral all derive from ONE spring value and
 *   ONE value→angle function — they can never disagree.
 * - The arc uses butt caps plus a terminal dot at the exact end angle, so the
 *   visible arc tip sits precisely under the needle (round caps used to
 *   overshoot by half the stroke width).
 * - No synthetic intermediate values: the spring animates *toward* real
 *   samples; the settled numeral is always the measured figure passed in.
 * - prefers-reduced-motion: values snap, nothing springs.
 *
 * Color: blue while measuring; orange once past 80% of the current scale;
 * the thin red arc at the top of the scale is a range marking, not a warning
 * that fast internet is dangerous.
 */

const START = 135; // degrees; 0 value
const SWEEP = 270; // degrees of travel
const CX = 100;
const CY = 100;
const R_RING = 87;
const R_ARC = 76;

const polar = (deg: number, r: number): [number, number] => {
  const rad = (deg * Math.PI) / 180;
  return [CX + r * Math.cos(rad), CY + r * Math.sin(rad)];
};

const arcPath = (fromDeg: number, toDeg: number, r: number): string => {
  const [x1, y1] = polar(fromDeg, r);
  const [x2, y2] = polar(toDeg, r);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${toDeg - fromDeg > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
};

/** Dial max that keeps the needle in a useful range. */
function dialMax(peak: number): number {
  for (const m of [100, 240, 500, 1000, 2500, 10000]) if (peak <= m * 0.96) return m;
  return 10000;
}

const fmtScale = (n: number) => (n >= 1000 ? `${n / 1000}k` : String(n));

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
  const [display, setDisplay] = useState(0);
  const [max, setMax] = useState(240);
  const physics = useRef({ value: 0, velocity: 0, target: 0 });
  const peakRef = useRef(0);
  const lastTickRef = useRef(0);
  const reduced = useRef(
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );

  // Target from real values only.
  useEffect(() => {
    const p = physics.current;
    if (done && finalMbps !== null) p.target = finalMbps;
    else if (active && liveMbps !== null) p.target = liveMbps;
    else if (!active && !done) p.target = 0;
    if (p.target > peakRef.current) {
      peakRef.current = p.target;
      setMax(dialMax(peakRef.current));
    }
    if (reduced.current) {
      p.value = p.target;
      p.velocity = 0;
      setDisplay(p.target);
    }
  }, [liveMbps, active, done, finalMbps]);

  // Reset when a new run begins.
  useEffect(() => {
    if (waiting && !active && !done) {
      peakRef.current = 0;
      setMax(240);
      physics.current.target = 0;
    }
  }, [waiting, active, done]);

  // Spring loop (skipped under reduced motion).
  useEffect(() => {
    if (reduced.current) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const p = physics.current;
      const accel = (p.target - p.value) * 42 - p.velocity * 9;
      p.velocity += accel * dt;
      p.value = Math.max(0, p.value + p.velocity * dt);
      lastTickRef.current = now;
      if (Math.abs(p.target - p.value) > 0.01 || Math.abs(p.velocity) > 0.01) setDisplay(p.value);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Watchdog: background tabs suspend rAF — snap so the dial is never stale.
  useEffect(() => {
    if (reduced.current) return;
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

  const frac = Math.min(display / max, 1);
  const angle = START + frac * SWEEP;
  const [nx1, ny1] = polar(angle, R_ARC - 26);
  const [nx2, ny2] = polar(angle, R_RING - 3);
  const [dotX, dotY] = polar(angle, R_ARC);

  const hot = frac >= 0.8; // orange near the top of the current scale
  const shown = done && finalMbps !== null ? finalMbps : active ? display : 0;
  const numeral = waiting && !active ? "···" : shown >= 100 ? String(Math.round(shown)) : shown.toFixed(1);
  const gradId = `gauge-grad-${label.toLowerCase().replace(/\s/g, "-")}`;

  return (
    <figure className="np-gauge" aria-label={`${label}: ${done && finalMbps !== null ? `${numeral} Mbps` : active ? "measuring" : "not yet measured"}`}>
      <svg viewBox="0 0 200 200" className="np-gauge__svg">
        <defs>
          <linearGradient id={gradId} x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.75" />
            <stop offset="100%" stopColor="var(--primary)" />
          </linearGradient>
        </defs>

        {/* track + ring */}
        <path d={arcPath(START, START + SWEEP, R_ARC)} className="np-gauge__track" />
        <path d={arcPath(START, START + SWEEP, R_RING)} className="np-gauge__ring" />
        {/* range marking: top 8% of scale */}
        <path d={arcPath(START + SWEEP * 0.92, START + SWEEP, R_RING)} className="np-gauge__redzone" />

        {/* minor ticks */}
        {Array.from({ length: 9 }, (_, i) => {
          const d = START + (i / 8) * SWEEP;
          const major = i % 4 === 0;
          const [tx1, ty1] = polar(d, R_RING - (major ? 7 : 4));
          const [tx2, ty2] = polar(d, R_RING + 1);
          return <line key={i} x1={tx1} y1={ty1} x2={tx2} y2={ty2} className={major ? "np-gauge__tick--major" : "np-gauge__tick"} />;
        })}

        {/* progress arc — butt caps + terminal dot = exact needle alignment */}
        {frac > 0.004 && (
          <>
            <path
              d={arcPath(START, angle, R_ARC)}
              className="np-gauge__sweep"
              stroke={hot ? "var(--status-warn)" : `url(#${gradId})`}
            />
            <circle cx={dotX} cy={dotY} r="5.5" fill={hot ? "var(--status-warn)" : "var(--primary)"} />
          </>
        )}

        {/* needle */}
        <line x1={nx1} y1={ny1} x2={nx2} y2={ny2} className="np-gauge__needle" />
      </svg>

      {/* scale labels */}
      <span className="np-gauge__scale np-gauge__scale--zero">0</span>
      <span className="np-gauge__scale np-gauge__scale--mid">{fmtScale(max / 2)}</span>
      <span className="np-gauge__scale np-gauge__scale--max">{fmtScale(max)}</span>

      {/* center cluster */}
      <figcaption className="np-gauge__center">
        <span className="np-gauge__label">{label}</span>
        <span className="np-gauge__value" data-hot={hot || undefined}>
          {numeral}
        </span>
        <span className="np-gauge__unit">MBPS</span>
      </figcaption>
    </figure>
  );
}
