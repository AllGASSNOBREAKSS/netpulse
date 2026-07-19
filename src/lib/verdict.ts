import type { TestResult } from "./engine";
import { computeScore, type ScorePart } from "./scoring";

/** Turns raw metrics into a health score, activity grades, and a diagnosis. */

export type Grade = "Excellent" | "Good" | "Fair" | "Poor";

export type Verdict = {
  score: number; // 0–100
  breakdown: ScorePart[]; // per-component points, from src/lib/scoring.ts
  headline: string;
  activities: { name: string; grade: Grade; note: string }[];
  good: string[];
  bad: string[];
  actions: string[];
  dontBuy?: string;
};

export function judge(r: TestResult): Verdict {
  // ---- Score (100) — formula lives in src/lib/scoring.ts ----
  const { total: score, parts: breakdown } = computeScore(r);
  const spikeRatio = r.probeCount > 0 ? r.spikes / r.probeCount : 0;

  // ---- Headline ----
  let headline: string;
  if (score >= 85) headline = "Fast and responsive, even under load";
  else if (score >= 70)
    headline = r.bufferbloatGrade <= "B" ? "Solid all-round connection" : "Fast, but unstable under load";
  else if (score >= 50) headline = "Usable, with real weak spots";
  else headline = "This connection is struggling";

  // ---- Activity grades ----
  const g = (cond: boolean, mid: boolean, low: boolean): Grade =>
    cond ? "Excellent" : mid ? "Good" : low ? "Fair" : "Poor";

  const loadedWorst = Math.max(r.loadedDownPingMs, r.loadedUpPingMs);
  const activities = [
    {
      name: "Competitive gaming",
      grade: g(
        r.idlePingMs < 25 && r.idleJitterMs < 6 && r.bufferbloatMs < 40,
        r.idlePingMs < 45 && r.idleJitterMs < 12 && r.bufferbloatMs < 80,
        r.idlePingMs < 70,
      ),
      note: `${Math.round(r.idlePingMs)}ms ping, ${Math.round(r.idleJitterMs)}ms jitter`,
    },
    {
      name: "Gaming while others download",
      grade: g(r.bufferbloatMs < 30, r.bufferbloatMs < 60, r.bufferbloatMs < 120),
      note: `+${Math.round(r.bufferbloatMs)}ms under load (grade ${r.bufferbloatGrade})`,
    },
    {
      name: "4K streaming",
      grade: g(r.downloadMbps > 50, r.downloadMbps > 25, r.downloadMbps > 15),
      note: `${r.downloadMbps > 25 ? Math.floor(r.downloadMbps / 25) : 0} simultaneous 4K streams`,
    },
    {
      name: "Video calls",
      grade: g(
        r.uploadMbps > 8 && loadedWorst < 120,
        r.uploadMbps > 3.5 && loadedWorst < 200,
        r.uploadMbps > 1.5,
      ),
      note: `${r.uploadMbps.toFixed(1)} Mbps up, ${Math.round(loadedWorst)}ms loaded`,
    },
    {
      name: "Cloud gaming",
      grade: g(
        r.downloadMbps > 45 && r.idlePingMs < 30 && r.idleJitterMs < 8,
        r.downloadMbps > 35 && r.idlePingMs < 45,
        r.downloadMbps > 20 && r.idlePingMs < 70,
      ),
      note: "needs steady low latency",
    },
    {
      name: "Livestreaming",
      grade: g(r.uploadMbps > 20 && spikeRatio === 0, r.uploadMbps > 10, r.uploadMbps > 6),
      note: `${r.uploadMbps.toFixed(1)} Mbps upload`,
    },
    {
      name: "Large uploads / backups",
      grade: g(r.uploadMbps > 40, r.uploadMbps > 15, r.uploadMbps > 5),
      note: `1 GB in ~${formatDuration(8000 / Math.max(r.uploadMbps, 0.1))}`,
    },
    {
      name: "Everyday browsing",
      grade: g(
        r.downloadMbps > 25 && r.idlePingMs < 60,
        r.downloadMbps > 10,
        r.downloadMbps > 3,
      ),
      note: "pages, apps, music",
    },
  ];

  // ---- Good / bad ----
  const good: string[] = [];
  const bad: string[] = [];
  if (r.downloadMbps >= 100) good.push(`Strong download capacity (${fmt(r.downloadMbps)} Mbps)`);
  else if (r.downloadMbps < 25) bad.push(`Low download capacity (${fmt(r.downloadMbps)} Mbps)`);
  if (r.uploadMbps >= 20) good.push(`Healthy upload (${fmt(r.uploadMbps)} Mbps)`);
  else if (r.uploadMbps < 5) bad.push(`Weak upload (${fmt(r.uploadMbps)} Mbps) — calls and backups will feel it`);
  if (r.idlePingMs < 20) good.push(`Low idle latency (${Math.round(r.idlePingMs)}ms)`);
  else if (r.idlePingMs > 60) bad.push(`High idle latency (${Math.round(r.idlePingMs)}ms)`);
  if (r.idleJitterMs < 5) good.push("Very steady latency (low jitter)");
  else if (r.idleJitterMs > 15) bad.push(`Jittery connection (±${Math.round(r.idleJitterMs)}ms between probes)`);
  if (r.bufferbloatGrade === "A") good.push("No meaningful bufferbloat — stays responsive under load");
  if (r.bufferbloatGrade >= "C")
    bad.push(
      `Latency rises +${Math.round(r.bufferbloatMs)}ms when the line is busy (bufferbloat grade ${r.bufferbloatGrade})`,
    );
  if (r.spikes > 0) bad.push(`${r.spikes} latency spike${r.spikes > 1 ? "s" : ""} detected during load`);

  // ---- Actions ----
  const actions: string[] = [];
  let dontBuy: string | undefined;
  if (r.bufferbloatGrade >= "C") {
    actions.push(
      "Enable SQM / Smart Queue Management (or QoS) on your router — it directly targets the latency-under-load problem.",
    );
    if (r.downloadMbps > 100)
      dontBuy = "A faster download plan. Your bandwidth is fine — the problem is how your router queues traffic when busy.";
  }
  if (r.idleJitterMs > 15 || r.spikes > 1)
    actions.push("If you're on Wi-Fi, re-test next to the router or over Ethernet — jitter this high usually means interference or weak signal.");
  if (r.uploadMbps < 5)
    actions.push("Check your plan's advertised upload speed — many cable plans are heavily asymmetric, and this may be all you're paying for.");
  if (r.idlePingMs > 60)
    actions.push("High base latency: check whether a VPN is on, and whether your connection is DSL/satellite — those set a floor no router can fix.");
  if (actions.length === 0)
    actions.push("Nothing urgent. Save this result as your baseline and re-test when something feels slow — the comparison is the diagnosis.");

  return { score, breakdown, headline, activities, good, bad, actions, dontBuy };
}

function fmt(n: number): string {
  return n >= 100 ? String(Math.round(n)) : n.toFixed(1);
}

function formatDuration(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}
