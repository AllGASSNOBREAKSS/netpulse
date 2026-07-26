export function gaugeNumeral(valueMbps: number, done: boolean, finalMbps: number | null): string {
  if (done && finalMbps === null) return "—";
  return valueMbps >= 100 ? String(Math.round(valueMbps)) : valueMbps.toFixed(1);
}
