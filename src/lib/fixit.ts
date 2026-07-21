/**
 * Fix My Internet — guided A/B isolation logic.
 *
 * The workflow: run a baseline, recommend the single most informative physical
 * change (tied to a measured weakness), let the user make it, re-test, then
 * compare before/after and draw an evidence-based conclusion. Every
 * recommendation and conclusion cites the numbers behind it, and the ISP-plan
 * verdict is derived from measurements — never a generic "upgrade your plan".
 */
import type { TestResult } from "./types";

export type Snapshot = {
  timestamp: number;
  downloadMbps: number;
  uploadMbps: number;
  idlePingMs: number;
  loadedDownPingMs: number;
  loadedUpPingMs: number;
  jitterMs: number;
  bufferbloatMs: number;
  bufferbloatGrade: string;
  stabilityScore: number;
  udpReachable: string;
  dataUsedMB: number;
};

export function snapshot(r: TestResult): Snapshot {
  return {
    timestamp: r.timestamp,
    downloadMbps: r.downloadMbps,
    uploadMbps: r.uploadMbps,
    idlePingMs: r.idlePingMs,
    loadedDownPingMs: r.loadedDownPingMs,
    loadedUpPingMs: r.loadedUpPingMs,
    jitterMs: r.idleJitterMs,
    bufferbloatMs: r.bufferbloatMs,
    bufferbloatGrade: r.bufferbloatGrade,
    stabilityScore: r.stability.score,
    udpReachable: r.packetLoss.udpReachable,
    dataUsedMB: r.dataUsedMB,
  };
}

export type StepId =
  | "ethernet"
  | "router"
  | "vpn"
  | "pause_uploads"
  | "other_device"
  | "different_time"
  | "change_dns"
  | "restart";

export type FixStep = {
  id: StepId;
  label: string;
  instruction: string;
  why: string;
  isolates: string;
};

const STEP_BASE: Record<StepId, Omit<FixStep, "why">> = {
  ethernet: {
    id: "ethernet",
    label: "Connect via Ethernet",
    instruction: "Plug this device directly into the router with an Ethernet cable, then run the comparison.",
    isolates: "Removes Wi-Fi entirely — the cleanest way to tell whether Wi-Fi is your bottleneck.",
  },
  router: {
    id: "router",
    label: "Move beside the router",
    instruction: "Bring this device right next to the router (same room, line of sight), then run the comparison.",
    isolates: "Isolates Wi-Fi coverage / distance from the rest of the connection.",
  },
  vpn: {
    id: "vpn",
    label: "Disable the VPN",
    instruction: "Turn off any VPN or proxy, then run the comparison.",
    isolates: "Isolates VPN/proxy overhead (extra hops and encryption).",
  },
  pause_uploads: {
    id: "pause_uploads",
    label: "Pause background uploads",
    instruction: "Pause cloud backup / photo sync / large uploads, then run the comparison.",
    isolates: "Isolates upload saturation — a common cause of latency spikes for everyone on the line.",
  },
  other_device: {
    id: "other_device",
    label: "Test another device",
    instruction: "Open NetPulse on a different device on the same network and compare its result to this one.",
    isolates: "Isolates whether the problem is this device (adapter, drivers, background apps) or the network.",
  },
  different_time: {
    id: "different_time",
    label: "Test at a different time",
    instruction: "Re-run in a few hours (ideally off-peak vs. evening peak), then compare.",
    isolates: "Isolates ISP peak-hour congestion from a persistent problem.",
  },
  change_dns: {
    id: "change_dns",
    label: "Change your DNS",
    instruction: "Switch your DNS to 1.1.1.1 or 8.8.8.8, then compare. Note: DNS mainly affects how fast names resolve, not raw throughput.",
    isolates: "Isolates slow name resolution — affects page-load feel more than the speed numbers here.",
  },
  restart: {
    id: "restart",
    label: "Restart the modem/router",
    instruction: "Power-cycle the modem and router (30s off), wait for them to come back, then compare.",
    isolates: "Clears a stuck modem/router state (overheated, memory-leaked, or bad session).",
  },
};

/**
 * Recommend the single most informative next step, tied to measured evidence.
 * Rules are priority-ordered; the first that applies and isn't already done wins.
 */
export function recommendStep(base: Snapshot, done: StepId[]): FixStep | null {
  const pick = (id: StepId, why: string): FixStep | null =>
    done.includes(id) ? null : { ...STEP_BASE[id], why };

  const candidates: (FixStep | null)[] = [
    // Upload-driven latency → pause background uploads first (cheap, revealing).
    base.loadedUpPingMs - base.idlePingMs > 80
      ? pick(
          "pause_uploads",
          `Your latency jumps +${Math.round(base.loadedUpPingMs - base.idlePingMs)} ms while uploading (idle ${Math.round(base.idlePingMs)} → ${Math.round(base.loadedUpPingMs)} ms). Background uploads are the usual culprit.`,
        )
      : null,
    // Weak throughput → isolate Wi-Fi with Ethernet.
    base.downloadMbps < 100
      ? pick(
          "ethernet",
          `Download measured ${base.downloadMbps.toFixed(0)} Mbps. If Ethernet is much faster, Wi-Fi — not your plan — is the limit.`,
        )
      : null,
    // High base latency → suspect VPN/route.
    base.idlePingMs > 60
      ? pick(
          "vpn",
          `Idle latency is high at ${Math.round(base.idlePingMs)} ms. A VPN or proxy is the most common fixable cause.`,
        )
      : null,
    // Jitter / instability → Wi-Fi interference, test beside router.
    base.jitterMs > 15 || base.stabilityScore < 60
      ? pick(
          "router",
          `Jitter ${base.jitterMs.toFixed(1)} ms and stability ${base.stabilityScore}/100 suggest Wi-Fi interference. Testing beside the router isolates it.`,
        )
      : null,
    // Bufferbloat on download without upload cause → likely router queue; try Ethernet then flag SQM.
    base.bufferbloatMs > 60
      ? pick(
          "ethernet",
          `Latency rises +${Math.round(base.bufferbloatMs)} ms under load (grade ${base.bufferbloatGrade}). Ethernet rules out Wi-Fi so we can pin bufferbloat to the router queue.`,
        )
      : null,
    // Everything looks OK locally → check for peak-hour congestion.
    pick(
      "different_time",
      `No obvious local weakness in this run. Comparing an off-peak vs. evening test isolates ISP congestion.`,
    ),
  ];

  return candidates.find((c): c is FixStep => c !== null) ?? null;
}

/** Remaining steps a user can choose manually. */
export function remainingSteps(done: StepId[]): FixStep[] {
  return (Object.keys(STEP_BASE) as StepId[])
    .filter((id) => !done.includes(id))
    .map((id) => ({ ...STEP_BASE[id], why: STEP_BASE[id].isolates }));
}

export type Delta = {
  key: string;
  label: string;
  unit: string;
  before: number;
  after: number;
  deltaPct: number;
  /** true when "after" is better for this metric (higher speed / lower latency). */
  better: boolean;
  higherIsBetter: boolean;
};

const METRICS: { key: keyof Snapshot; label: string; unit: string; higherIsBetter: boolean }[] = [
  { key: "downloadMbps", label: "Download", unit: "Mbps", higherIsBetter: true },
  { key: "uploadMbps", label: "Upload", unit: "Mbps", higherIsBetter: true },
  { key: "idlePingMs", label: "Idle latency", unit: "ms", higherIsBetter: false },
  { key: "loadedDownPingMs", label: "Loaded latency (down)", unit: "ms", higherIsBetter: false },
  { key: "loadedUpPingMs", label: "Loaded latency (up)", unit: "ms", higherIsBetter: false },
  { key: "jitterMs", label: "Jitter", unit: "ms", higherIsBetter: false },
  { key: "bufferbloatMs", label: "Bufferbloat rise", unit: "ms", higherIsBetter: false },
  { key: "stabilityScore", label: "Stability", unit: "/100", higherIsBetter: true },
];

export function compare(before: Snapshot, after: Snapshot): Delta[] {
  return METRICS.map((m) => {
    const b = before[m.key] as number;
    const a = after[m.key] as number;
    const deltaPct = b === 0 ? 0 : ((a - b) / Math.abs(b)) * 100;
    const better = m.higherIsBetter ? a > b : a < b;
    return { key: String(m.key), label: m.label, unit: m.unit, before: b, after: a, deltaPct, better, higherIsBetter: m.higherIsBetter };
  });
}

export type StepOutcome = {
  stepId: StepId;
  label: string;
  before: Snapshot;
  after: Snapshot;
  deltas: Delta[];
  helped: boolean;
  magnitude: number; // 0–1
  headline: string;
};

/** Which metric proves/refutes each step, and how much it moved. */
export function evaluateStep(stepId: StepId, before: Snapshot, after: Snapshot): StepOutcome {
  const deltas = compare(before, after);
  const rel = (b: number, a: number) => (b === 0 ? 0 : (a - b) / Math.abs(b));

  let magnitude = 0;
  let helped = false;
  let headline = "";

  const dlUp = rel(before.downloadMbps, after.downloadMbps);
  const idleDrop = rel(after.idlePingMs, before.idlePingMs); // positive = latency fell
  const loadedUpDrop = rel(after.loadedUpPingMs, before.loadedUpPingMs);

  switch (stepId) {
    case "ethernet":
    case "router":
    case "other_device":
    case "different_time":
    case "restart":
      magnitude = clamp01(Math.max(dlUp, rel(after.loadedDownPingMs, before.loadedDownPingMs)));
      helped = dlUp > 0.25 || rel(after.loadedDownPingMs, before.loadedDownPingMs) > 0.3;
      headline = helped
        ? `Download went ${before.downloadMbps.toFixed(0)} → ${after.downloadMbps.toFixed(0)} Mbps after "${STEP_BASE[stepId].label.toLowerCase()}".`
        : `"${STEP_BASE[stepId].label}" changed download little (${before.downloadMbps.toFixed(0)} → ${after.downloadMbps.toFixed(0)} Mbps).`;
      break;
    case "vpn":
      magnitude = clamp01(Math.max(idleDrop, dlUp));
      helped = idleDrop > 0.25 || dlUp > 0.25;
      headline = helped
        ? `Idle latency fell ${Math.round(before.idlePingMs)} → ${Math.round(after.idlePingMs)} ms with the VPN off.`
        : `Turning off the VPN barely changed latency (${Math.round(before.idlePingMs)} → ${Math.round(after.idlePingMs)} ms).`;
      break;
    case "pause_uploads":
      magnitude = clamp01(loadedUpDrop);
      helped = loadedUpDrop > 0.3;
      headline = helped
        ? `Upload-loaded latency fell ${Math.round(before.loadedUpPingMs)} → ${Math.round(after.loadedUpPingMs)} ms once uploads paused.`
        : `Pausing uploads barely moved upload-loaded latency (${Math.round(before.loadedUpPingMs)} → ${Math.round(after.loadedUpPingMs)} ms).`;
      break;
    case "change_dns":
      magnitude = 0; // throughput/latency here don't capture DNS resolution
      helped = false;
      headline = `DNS mainly affects page-load feel, which this throughput test doesn't isolate — judge it by browsing responsiveness, not these numbers.`;
      break;
  }

  return { stepId, label: STEP_BASE[stepId].label, before, after, deltas, helped, magnitude, headline };
}

export type Conclusion = {
  bottleneck: string;
  summary: string;
  confidence: number;
  ispUpgradeHelps: "unlikely" | "possibly" | "unknown";
  ispNote: string;
  evidence: string[];
};

const BOTTLENECK: Record<StepId, string> = {
  ethernet: "Local Wi-Fi (this device's wireless link)",
  router: "Wi-Fi coverage / distance from the router",
  vpn: "VPN or proxy overhead",
  pause_uploads: "Upload saturation (background uploads flooding the line)",
  other_device: "This device (adapter, drivers, or background apps)",
  different_time: "ISP peak-hour congestion",
  change_dns: "DNS resolution",
  restart: "A stuck modem/router state",
};

export function conclude(base: Snapshot, outcomes: StepOutcome[]): Conclusion {
  const helpful = outcomes.filter((o) => o.helped).sort((a, b) => b.magnitude - a.magnitude);
  const best = helpful[0];

  if (best) {
    const confidence = Math.min(95, Math.round(50 + best.magnitude * 40 + outcomes.length * 3));
    const ispUpgradeHelps: Conclusion["ispUpgradeHelps"] =
      best.stepId === "different_time" ? "possibly" : "unlikely";
    const ispNote =
      best.stepId === "different_time"
        ? "Speeds recover off-peak, so this is congestion, not your plan size. A faster plan may not help during peak hours — raise the congestion with your ISP instead."
        : `Your line already delivered ${best.after.downloadMbps.toFixed(0)} Mbps once "${best.label.toLowerCase()}" removed the bottleneck, so a faster plan won't raise a ceiling you've already reached. Fix ${BOTTLENECK[best.stepId].toLowerCase()} instead.`;
    return {
      bottleneck: BOTTLENECK[best.stepId],
      summary: `${best.headline} The most likely bottleneck is ${BOTTLENECK[best.stepId].toLowerCase()}.`,
      confidence,
      ispUpgradeHelps,
      ispNote,
      evidence: helpful.map((o) => o.headline),
    };
  }

  // Nothing local moved the needle.
  const steady = outcomes.length > 0;
  if (steady) {
    return {
      bottleneck: "Likely the ISP line or plan itself",
      summary: `None of the ${outcomes.length} change(s) you tried raised throughput or lowered latency meaningfully, and results stayed near ${base.downloadMbps.toFixed(0)} Mbps. That points upstream — to the line or plan — rather than to your local setup.`,
      confidence: Math.min(75, 45 + outcomes.length * 8),
      ispUpgradeHelps: "possibly",
      ispNote:
        "Because local changes didn't help, the limit appears to be upstream. Before upgrading, confirm your plan's rated speed on your bill — you may already be getting what you pay for, in which case a higher tier is the only lever.",
      evidence: outcomes.map((o) => o.headline),
    };
  }

  return {
    bottleneck: "Not yet determined",
    summary: "Run a baseline and at least one comparison step to reach a conclusion.",
    confidence: 0,
    ispUpgradeHelps: "unknown",
    ispNote: "",
    evidence: [],
  };
}

export type FixSession = {
  id: string;
  startedAt: number;
  baseline: Snapshot;
  outcomes: StepOutcome[];
  conclusion: Conclusion | null;
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/* ---- Export (privacy-safe; pure, no DOM) ---------------------------------- */
export function fixSessionExport(s: FixSession) {
  return {
    tool: "NetPulse — Fix My Internet",
    sessionId: s.id,
    startedAt: new Date(s.startedAt).toISOString(),
    baseline: s.baseline,
    steps: s.outcomes.map((o) => ({
      step: o.stepId,
      label: o.label,
      helped: o.helped,
      magnitude: Math.round(o.magnitude * 100) / 100,
      headline: o.headline,
      before: o.before,
      after: o.after,
    })),
    conclusion: s.conclusion,
  };
}

export function fixCsvRows(s: FixSession): Record<string, string | number>[] {
  const row = (label: string, snap: Snapshot) => ({
    stage: label,
    download_mbps: snap.downloadMbps.toFixed(1),
    upload_mbps: snap.uploadMbps.toFixed(1),
    idle_ms: Math.round(snap.idlePingMs),
    loaded_down_ms: Math.round(snap.loadedDownPingMs),
    loaded_up_ms: Math.round(snap.loadedUpPingMs),
    jitter_ms: snap.jitterMs.toFixed(1),
    bufferbloat_ms: Math.round(snap.bufferbloatMs),
    stability: snap.stabilityScore,
  });
  return [row("baseline", s.baseline), ...s.outcomes.map((o) => row(o.label, o.after))];
}

export function buildFixReport(s: FixSession): string {
  const L = (n: number, d = 0) => n.toFixed(d);
  const lines = [
    `# NetPulse — Fix My Internet report`,
    ``,
    `**Baseline:** ${L(s.baseline.downloadMbps, 1)} Mbps down / ${L(s.baseline.uploadMbps, 1)} up · idle ${L(s.baseline.idlePingMs)} ms · bufferbloat ${s.baseline.bufferbloatGrade}`,
    ``,
    `## Steps tried`,
  ];
  for (const o of s.outcomes) {
    lines.push(`### ${o.label} — ${o.helped ? "helped" : "no meaningful change"}`);
    lines.push(o.headline);
    for (const d of o.deltas) {
      const arrow = d.before === d.after ? "→" : d.better ? "↑ better" : "↓ worse";
      lines.push(`- ${d.label}: ${L(d.before, 1)} → ${L(d.after, 1)} ${d.unit} (${arrow})`);
    }
    lines.push("");
  }
  if (s.conclusion) {
    lines.push(`## Conclusion`);
    lines.push(`**Likely bottleneck:** ${s.conclusion.bottleneck}`);
    lines.push(`**Confidence:** ${s.conclusion.confidence}%`);
    lines.push(s.conclusion.summary);
    lines.push(``);
    lines.push(`**Will a faster ISP plan help?** ${s.conclusion.ispUpgradeHelps}. ${s.conclusion.ispNote}`);
  }
  lines.push(``);
  lines.push(`_Measured with NetPulse (light A/B profile) against Cloudflare's anycast endpoint. No public IP included._`);
  return lines.join("\n");
}
