import type { CSSProperties } from "react";
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
  valueMbps,
  active,
  done,
  hasMeasured,
  finalMbps,
}: {
  label: string;
  valueMbps: number;
  active: boolean;
  done: boolean;
  hasMeasured: boolean;
  finalMbps: number | null;
}) {
  const fraction = speedToDialFraction(valueMbps);
  const angle = START + fraction * SWEEP;
  const currentBand = speedBand(valueMbps);
  const speedColor = BAND_COLORS[currentBand];
  const idle = !active && !done && !hasMeasured;
  const numeral = formatValue(valueMbps);
  const [capX, capY] = polar(angle, R_ARC);

  const status = done && finalMbps !== null
    ? `${formatValue(finalMbps)} megabits per second`
    : active
      ? "measuring"
      : hasMeasured
        ? `${formatValue(valueMbps)} megabits per second`
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

        <path
          d={arcPath(START, START + SWEEP, R_ARC)}
          pathLength="1"
          strokeDasharray="1"
          strokeDashoffset={1 - fraction}
          className="np-gauge__sweep"
        />
        <circle cx={capX} cy={capY} r="4.5" className="np-gauge__cap" opacity={fraction > 0.001 ? 1 : 0} />

        <line
          x1={CX + R_ARC - 24}
          y1={CY}
          x2={CX + R_RING - 3}
          y2={CY}
          transform={`rotate(${angle} ${CX} ${CY})`}
          className="np-gauge__needle"
        />

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
