import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import {
  SPEEDOMETER_BANDS,
  SPEEDOMETER_CEILING_MBPS,
  speedBand,
  speedToDialFraction,
} from "@/lib/speedometer";

const START = 135;
const SWEEP = 270;
const CX = 100;
const CY = 100;
const R_RING = 87;
const R_ARC = 76;
const TICKS = 13;

const BAND_COLORS = {
  blue: "var(--speed-blue)",
  yellow: "var(--speed-yellow)",
  orange: "var(--speed-orange)",
  red: "var(--speed-red)",
} as const;

const SCALE_LABELS = [
  { fraction: 0, label: "0" },
  { fraction: 0.25, label: "100" },
  { fraction: 0.5, label: "200" },
  { fraction: 0.75, label: "500" },
  { fraction: 1, label: `${SPEEDOMETER_CEILING_MBPS}+` },
] as const;

const polar = (degrees: number, radius: number): [number, number] => {
  const radians = (degrees * Math.PI) / 180;
  return [CX + radius * Math.cos(radians), CY + radius * Math.sin(radians)];
};

const arcPath = (fromDegrees: number, toDegrees: number, radius: number): string => {
  const [startX, startY] = polar(fromDegrees, radius);
  const [endX, endY] = polar(toDegrees, radius);
  const largeArc = toDegrees - fromDegrees > 180 ? 1 : 0;
  return `M ${startX.toFixed(2)} ${startY.toFixed(2)} A ${radius} ${radius} 0 ${largeArc} 1 ${endX.toFixed(2)} ${endY.toFixed(2)}`;
};

const formatValue = (value: number) => (value >= 100 ? String(Math.round(value)) : value.toFixed(1));

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
  const reducedMotion = useReducedMotion();
  const [display, setDisplay] = useState(0);
  const valueRef = useRef(0);
  const renderedRef = useRef(0);
  const targetRef = useRef(0);
  const armedRef = useRef(false);

  const hasMeasured = liveMbps !== null || (done && finalMbps !== null);
  const target = done && finalMbps !== null ? finalMbps : liveMbps ?? 0;
  const armed = waiting && !active && !done;

  useEffect(() => {
    if (armed && !armedRef.current) {
      valueRef.current = 0;
      renderedRef.current = 0;
      targetRef.current = 0;
      setDisplay(0);
    }
    armedRef.current = armed;
  }, [armed]);

  useEffect(() => {
    targetRef.current = Math.max(0, target);
    if (reducedMotion) {
      valueRef.current = targetRef.current;
      renderedRef.current = targetRef.current;
      setDisplay(targetRef.current);
    }
  }, [reducedMotion, target]);

  useEffect(() => {
    if (reducedMotion) return;
    let animationFrame = 0;
    let previousTime = performance.now();

    const tick = (time: number) => {
      const elapsedSeconds = Math.min((time - previousTime) / 1000, 0.05);
      previousTime = time;
      const current = valueRef.current;
      const nextTarget = targetRef.current;
      const timeConstant = nextTarget >= current ? 0.34 : 0.58;
      const blend = 1 - Math.exp(-elapsedSeconds / timeConstant);
      const next = Math.abs(nextTarget - current) < 0.025
        ? nextTarget
        : current + (nextTarget - current) * blend;
      valueRef.current = next;

      const reachedTarget = next === nextTarget && renderedRef.current !== nextTarget;
      if (Math.abs(next - renderedRef.current) >= 0.02 || reachedTarget) {
        renderedRef.current = next;
        setDisplay(next);
      }
      animationFrame = requestAnimationFrame(tick);
    };

    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [reducedMotion]);

  useEffect(() => {
    if (reducedMotion) return;
    const syncVisibleValue = () => {
      if (document.visibilityState !== "visible") return;
      const measuredTarget = targetRef.current;
      valueRef.current = measuredTarget;
      renderedRef.current = measuredTarget;
      setDisplay(measuredTarget);
    };
    document.addEventListener("visibilitychange", syncVisibleValue);
    return () => document.removeEventListener("visibilitychange", syncVisibleValue);
  }, [reducedMotion]);

  const visualValue = reducedMotion ? target : display;
  const fraction = speedToDialFraction(visualValue);
  const angle = START + fraction * SWEEP;
  const currentBand = speedBand(visualValue);
  const speedColor = BAND_COLORS[currentBand];
  const idle = !active && !done && !hasMeasured;
  const numeral = formatValue(visualValue);
  const [capX, capY] = polar(angle, R_ARC);

  const status = done && finalMbps !== null
    ? `${formatValue(finalMbps)} megabits per second`
    : active
      ? "measuring"
      : hasMeasured
        ? `${formatValue(visualValue)} megabits per second`
        : "not yet measured";

  return (
    <figure
      className="np-gauge"
      data-speed-band={currentBand}
      role="img"
      aria-label={`${label}: ${status}`}
      style={{ "--speed-color": speedColor } as CSSProperties}
    >
      <svg viewBox="0 0 200 200" className="np-gauge__svg" aria-hidden="true">
        <path d={arcPath(START, START + SWEEP, R_ARC)} className="np-gauge__track" />

        {SPEEDOMETER_BANDS.map((segment) => (
          <path
            key={segment.band}
            d={arcPath(START + segment.start * SWEEP, START + segment.end * SWEEP, R_RING)}
            className={`np-gauge__band np-gauge__band--${segment.band}`}
          />
        ))}

        {Array.from({ length: TICKS }, (_, index) => {
          const tickFraction = index / (TICKS - 1);
          const degrees = START + tickFraction * SWEEP;
          const major = index % 3 === 0;
          const [innerX, innerY] = polar(degrees, R_RING - (major ? 8 : 4.5));
          const [outerX, outerY] = polar(degrees, R_RING + 1);
          return (
            <line
              key={index}
              x1={innerX}
              y1={innerY}
              x2={outerX}
              y2={outerY}
              className={major ? "np-gauge__tick--major" : "np-gauge__tick"}
              data-on={fraction >= tickFraction - 0.001 && !idle || undefined}
            />
          );
        })}

        {fraction > 0.001 && (
          <>
            <path d={arcPath(START, angle, R_ARC)} className="np-gauge__sweep" />
            <circle cx={capX} cy={capY} r="4.5" className="np-gauge__cap" />
          </>
        )}

        <line
          x1={CX + R_ARC - 24}
          y1={CY}
          x2={CX + R_RING - 3}
          y2={CY}
          transform={`rotate(${angle} ${CX} ${CY})`}
          className="np-gauge__needle"
        />
        <circle cx={CX} cy={CY} r="3" className="np-gauge__hub" />

        {SCALE_LABELS.map(({ fraction: labelFraction, label: scaleLabel }) => {
          const [labelX, labelY] = polar(START + labelFraction * SWEEP, R_RING - 17);
          return (
            <text
              key={scaleLabel}
              x={labelX}
              y={labelY}
              className="np-gauge__scale"
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {scaleLabel}
            </text>
          );
        })}
      </svg>

      <figcaption className="np-gauge__center">
        <span className="np-gauge__label">{label}</span>
        <span className="np-gauge__value" data-idle={idle || undefined}>{numeral}</span>
        <span className="np-gauge__unit">Mbps</span>
      </figcaption>
    </figure>
  );
}
