/** Mask a public IP for display. The full address is never stored or exported. */
export function maskIp(ip: string): string {
  if (!ip) return "•••";
  if (ip.includes(":")) {
    const groups = ip.split(":");
    return `${groups[0]}:${groups[1] || ""}:••••:••••`;
  }
  const parts = ip.split(".");
  if (parts.length !== 4) return "•••";
  return `${parts[0]}.${parts[1]}.•••.•••`;
}
