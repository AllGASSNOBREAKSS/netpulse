export const SPEEDOMETER_CEILING_MBPS = 3000;

export type SpeedBand = "blue" | "yellow" | "orange" | "red";

export const SPEEDOMETER_BANDS = [
  { band: "blue", minMbps: 0, maxMbps: 100, start: 0, end: 0.25 },
  { band: "yellow", minMbps: 100, maxMbps: 200, start: 0.25, end: 0.5 },
  { band: "orange", minMbps: 200, maxMbps: 500, start: 0.5, end: 0.75 },
  { band: "red", minMbps: 500, maxMbps: SPEEDOMETER_CEILING_MBPS, start: 0.75, end: 1 },
] as const;

export function speedBand(mbps: number): SpeedBand {
  if (mbps < 100) return "blue";
  if (mbps < 200) return "yellow";
  if (mbps < 500) return "orange";
  return "red";
}

/**
 * Map real Mbps onto a fixed, piecewise dial. Each user-facing speed band gets
 * one quarter of the arc, so low-speed connections remain readable without
 * rescaling the gauge during a run. Values above 3 Gbps pin to the end and
 * remain visible as their real numeric value.
 */
export function speedToDialFraction(mbps: number): number {
  const speed = Number.isFinite(mbps) ? Math.max(0, mbps) : 0;
  const segment = SPEEDOMETER_BANDS.find((item) => speed <= item.maxMbps) ?? SPEEDOMETER_BANDS.at(-1)!;
  const bounded = Math.min(speed, segment.maxMbps);
  const range = segment.maxMbps - segment.minMbps;
  const progress = range > 0 ? (bounded - segment.minMbps) / range : 0;
  return segment.start + progress * (segment.end - segment.start);
}
