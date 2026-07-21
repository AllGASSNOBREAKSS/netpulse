import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useReducedMotion } from "../hooks/use-reduced-motion";
import { SPEEDOMETER_BANDS, SPEEDOMETER_CEILING_MBPS, speedBand, speedToDialFraction } from "../lib/speedometer";
import type { Phase } from "../lib/engine";

const START_DEG = 135;
const SWEEP_DEG = 270;
const CX = 200;
const CY = 200;
const R_RING = 172;
const R_ARC = 157;

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

function polar(deg: number, radius: number): [number, number] {
  const radians = (deg * Math.PI) / 180;
  return [CX + radius * Math.cos(radians), CY + radius * Math.sin(radians)];
}

function arcPath(fromDeg: number, toDeg: number, radius: number): string {
  const [x1, y1] = polar(fromDeg, radius);
  const [x2, y2] = polar(toDeg, radius);
  const large = toDeg - fromDeg > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2}`;
}

export default function Speedometer({
  liveMbps,
  phase,
  dataUsedMB,
  finalScore,
  lowData,
  onScoreClick,
}: {
  liveMbps: number | null;
  phase: Phase;
  dataUsedMB: number;
  finalScore: number | null;
  lowData: boolean;
  onScoreClick?: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const [display, setDisplay] = useState(0);
  const valueRef = useRef(0);
  const targetRef = useRef(0);
  const renderedRef = useRef(0);
  const isThroughput = phase === "download_single" || phase === "download_multi" || phase === "upload";
  const targetValue = liveMbps !== null && (isThroughput || phase === "done") ? Math.max(0, liveMbps) : 0;

  useEffect(() => {
    targetRef.current = targetValue;
    if (reducedMotion) {
      valueRef.current = targetValue;
      renderedRef.current = targetValue;
    }
  }, [reducedMotion, targetValue]);

  useEffect(() => {
    if (reducedMotion) return;
    let animationFrame = 0;
    let previousTime = performance.now();

    const tick = (time: number) => {
      const elapsedSeconds = Math.min((time - previousTime) / 1000, 0.05);
      previousTime = time;
      const current = valueRef.current;
      const target = targetRef.current;
      const timeConstant = target >= current ? 0.34 : 0.58;
      const blend = 1 - Math.exp(-elapsedSeconds / timeConstant);
      const next = Math.abs(target - current) < 0.025 ? target : current + (target - current) * blend;
      valueRef.current = next;
      const reachedTarget = next === target && renderedRef.current !== target;
      if (Math.abs(next - renderedRef.current) >= 0.02 || reachedTarget) {
        renderedRef.current = next;
        setDisplay(next);
      }
      animationFrame = requestAnimationFrame(tick);
    };

    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [reducedMotion]);

  const visualValue = reducedMotion ? targetValue : display;
  const fraction = speedToDialFraction(visualValue);
  const needleDegrees = START_DEG + fraction * SWEEP_DEG;
  const currentBand = speedBand(visualValue);
  const speedColor = BAND_COLORS[currentBand];
  const shown = visualValue >= 100 ? String(Math.round(visualValue)) : visualValue.toFixed(1);
  const dataFraction = Math.min(dataUsedMB / (lowData ? 40 : 400), 1);

  return (
    <div
      className="speedo"
      data-speed-band={currentBand}
      style={{ "--speed-color": speedColor } as CSSProperties}
      aria-label={`${shown} megabits per second`}
    >
      <svg viewBox="0 0 400 400" className="speedo__dial" aria-hidden="true">
        <path d={arcPath(START_DEG, START_DEG + SWEEP_DEG, R_RING)} className="speedo__ring" />

        {SPEEDOMETER_BANDS.map((segment) => (
          <path
            key={segment.band}
            d={arcPath(START_DEG + segment.start * SWEEP_DEG, START_DEG + segment.end * SWEEP_DEG, R_RING)}
            className={`speedo__band speedo__band--${segment.band}`}
          />
        ))}

        {fraction > 0.001 && (
          <path
            d={arcPath(START_DEG, START_DEG + fraction * SWEEP_DEG, R_ARC)}
            className="speedo__sweep"
          />
        )}

        <line
          x1={CX + R_ARC - 32}
          y1={CY}
          x2={CX + R_RING - 5}
          y2={CY}
          transform={`rotate(${needleDegrees} ${CX} ${CY})`}
          className="speedo__needle"
        />

        {SCALE_LABELS.map(({ fraction: labelFraction, label }) => {
          const degrees = START_DEG + labelFraction * SWEEP_DEG;
          const [tickInnerX, tickInnerY] = polar(degrees, R_RING - 10);
          const [tickOuterX, tickOuterY] = polar(degrees, R_RING + 2);
          const [labelX, labelY] = polar(degrees, R_RING - 30);
          return (
            <g key={label}>
              <line x1={tickInnerX} y1={tickInnerY} x2={tickOuterX} y2={tickOuterY} className="speedo__tick" />
              <text x={labelX} y={labelY} className="speedo__scale" textAnchor="middle" dominantBaseline="middle">{label}</text>
            </g>
          );
        })}
      </svg>

      <div className="speedo__center">
        <span className="speedo__value">{shown}</span>
        <span className="speedo__unit">Mbps</span>
        {finalScore !== null && phase === "done" && (
          <button className="speedo__score" onClick={onScoreClick} title="See how this score is calculated">
            health {finalScore}/100 ⓘ
          </button>
        )}
      </div>

      <div className="speedo__fuel" title="Application payload measured by this test">
        <span className="speedo__fuel-track">
          <span className="speedo__fuel-fill" style={{ width: `${Math.max(dataFraction * 100, 2)}%` }} />
        </span>
        <span className="speedo__fuel-label">{dataUsedMB.toFixed(0)} MB</span>
      </div>
    </div>
  );
}
