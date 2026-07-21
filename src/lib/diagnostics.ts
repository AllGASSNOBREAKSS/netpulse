import type { TestResult } from "./types";

export const DIAGNOSTIC_SCHEMA_VERSION = 1;

export type DiagnosticSymptom =
  | "buffering-video"
  | "video-calls"
  | "gaming"
  | "slow-downloads"
  | "slow-uploads"
  | "slow-websites"
  | "intermittent"
  | "offline"
  | "other";

export type DiagnosticRunKind =
  | "baseline"
  | "near-router"
  | "original-room"
  | "ethernet"
  | "vpn-off"
  | "background-paused"
  | "other-device"
  | "router-restarted"
  | "modem-restarted"
  | "peak-time"
  | "off-peak"
  | "ipv4"
  | "ipv6";

export type DiagnosticConditions = {
  link: "wifi" | "ethernet" | "unknown";
  location: "usual" | "near-router" | "unknown";
  vpn: "on" | "off" | "unknown";
  backgroundTraffic: "normal" | "paused" | "unknown";
  device: "primary" | "other";
  time: "usual" | "peak" | "off-peak";
  afterRestart: "none" | "router" | "modem";
  requestedIpFamily: "auto" | "ipv4" | "ipv6";
};

export type DiagnosticMeasurement = {
  downloadMbps: number;
  uploadMbps: number;
  idleLatencyMs: number;
  jitterMs: number;
  loadedDownMs: number;
  loadedUpMs: number;
  bufferbloatDownMs: number;
  bufferbloatUpMs: number;
  stabilityScore: number;
  confidenceScore: number;
  durationMs: number;
  dataUsedMB: number;
  idleSamples: number;
  loadedDownSamples: number;
  loadedUpSamples: number;
  endpointProvider: string;
  endpointEdge: string | null;
  endpointProtocol: string;
  observedIpFamily: "IPv4" | "IPv6" | "unknown";
  lowData: boolean;
  packetLossStatus: "unavailable";
  limitations: string[];
};

export type DiagnosticRun = {
  id: string;
  kind: DiagnosticRunKind;
  label: string;
  measuredAt: number;
  conditions: DiagnosticConditions;
  measurement: DiagnosticMeasurement;
};

export type DiagnosticSession = {
  schemaVersion: typeof DIAGNOSTIC_SCHEMA_VERSION;
  id: string;
  createdAt: number;
  updatedAt: number;
  symptom: DiagnosticSymptom;
  planDownloadMbps: number | null;
  planUploadMbps: number | null;
  runs: DiagnosticRun[];
};

export type AssessmentState = "supported" | "possible" | "not-supported" | "unavailable";

export type CauseAssessment = {
  id:
    | "bufferbloat"
    | "latency-instability"
    | "wireless-path"
    | "vpn-overhead"
    | "background-traffic"
    | "device-browser"
    | "gateway-state"
    | "peak-congestion"
    | "isp-access"
    | "dns"
    | "route-server"
    | "packet-loss"
    | "regional-outage";
  title: string;
  state: AssessmentState;
  confidence: number;
  evidence: string[];
  alternatives: string[];
  nextTest: string;
  action: string;
  unlikelyToHelp: string;
  methodology: string;
};

export type DiagnosticEvaluation = {
  assessments: CauseAssessment[];
  prioritized: CauseAssessment[];
  fixPlan: Array<{ title: string; reason: string; verify: string }>;
  purchaseGuidance: string;
  summary: string;
};

export const SYMPTOMS: ReadonlyArray<{
  id: DiagnosticSymptom;
  label: string;
  description: string;
}> = [
  { id: "buffering-video", label: "Video buffers", description: "Streams pause, downgrade quality, or take too long to start." },
  { id: "video-calls", label: "Calls break up", description: "Audio, video, or screen sharing freezes or becomes unstable." },
  { id: "gaming", label: "Gaming lag", description: "Latency spikes, rubber-banding, or delayed controls affect play." },
  { id: "slow-downloads", label: "Downloads are slow", description: "Large transfers or app updates take longer than expected." },
  { id: "slow-uploads", label: "Uploads are slow", description: "Cloud backup, file sharing, or publishing is constrained." },
  { id: "slow-websites", label: "Websites feel slow", description: "Pages hesitate even when large downloads seem acceptable." },
  { id: "intermittent", label: "Connection drops", description: "Connectivity or performance changes unpredictably." },
  { id: "offline", label: "Nothing connects", description: "This device cannot reach internet services." },
  { id: "other", label: "Something else", description: "Start with a baseline and let measured evidence narrow the issue." },
] as const;

export const DEFAULT_CONDITIONS: DiagnosticConditions = {
  link: "unknown",
  location: "usual",
  vpn: "unknown",
  backgroundTraffic: "normal",
  device: "primary",
  time: "usual",
  afterRestart: "none",
  requestedIpFamily: "auto",
};

export function createDiagnosticSession(symptom: DiagnosticSymptom, now = Date.now()): DiagnosticSession {
  return {
    schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
    id: createId("diagnostic", now),
    createdAt: now,
    updatedAt: now,
    symptom,
    planDownloadMbps: null,
    planUploadMbps: null,
    runs: [],
  };
}

export function snapshotDiagnosticRun(
  result: TestResult,
  kind: DiagnosticRunKind,
  label: string,
  conditions: DiagnosticConditions,
): DiagnosticRun {
  return {
    id: createId("run", result.timestamp),
    kind,
    label,
    measuredAt: result.timestamp,
    conditions: { ...conditions },
    measurement: {
      downloadMbps: result.downloadMbps,
      uploadMbps: result.uploadMbps,
      idleLatencyMs: result.idlePingMs,
      jitterMs: result.idleJitterMs,
      loadedDownMs: result.loadedDownPingMs,
      loadedUpMs: result.loadedUpPingMs,
      bufferbloatDownMs: result.bufferbloat.downloadMs,
      bufferbloatUpMs: result.bufferbloat.uploadMs,
      stabilityScore: result.stability.score,
      confidenceScore: result.confidence.score,
      durationMs: result.durationMs,
      dataUsedMB: result.dataUsedMB,
      idleSamples: result.idleLatency.count,
      loadedDownSamples: result.loadedDown.count,
      loadedUpSamples: result.loadedUp.count,
      endpointProvider: result.server.chosen.provider,
      endpointEdge: result.server.chosen.edgeCode,
      endpointProtocol: result.server.chosen.protocol,
      observedIpFamily: result.ispLocation.ipFamily,
      lowData: result.lowData,
      packetLossStatus: "unavailable",
      limitations: [...result.limitations],
    },
  };
}

export function evaluateDiagnostic(session: DiagnosticSession): DiagnosticEvaluation {
  const baseline = session.runs.find((run) => run.kind === "baseline") ?? session.runs[0];
  if (!baseline) return emptyEvaluation();

  const assessments = [
    assessBufferbloat(baseline),
    assessInstability(baseline),
    assessWireless(session, baseline),
    assessVpn(session, baseline),
    assessBackgroundTraffic(session, baseline),
    assessDevice(session, baseline),
    assessGatewayState(session, baseline),
    assessPeakCongestion(session),
    assessIspAccess(session),
    unavailableAssessment(
      "dns",
      "DNS resolution",
      "This browser run measures HTTPS transfer and latency after name resolution; it does not isolate recursive DNS lookup time or validate the configured resolver.",
      "Use an operating-system resolver diagnostic or a future controlled NetPulse DNS endpoint, then compare repeated queries with cache state disclosed.",
      "Do not change DNS solely because a speed test is slow; DNS changes do not increase sustained transfer capacity.",
    ),
    unavailableAssessment(
      "route-server",
      "Routing or test-server limitation",
      "NetPulse currently measures one Cloudflare anycast provider. Edge codes can change, but that is not a controlled independent-server comparison.",
      "Compare the same device and connection against a second documented measurement provider before attributing a result to routing or one server.",
      "Do not replace networking hardware based on a single endpoint path.",
    ),
    unavailableAssessment(
      "packet-loss",
      "End-to-end packet loss",
      "The current STUN check reports UDP reachability only. No packet-loss percentage is measured or used by this diagnostic.",
      "Run a sustained test against a cooperating UDP echo/TURN service or an operating-system path tool that reports sent and received probes.",
      "Do not diagnose loss from jitter, failed fetches, or UDP reachability alone.",
    ),
    unavailableAssessment(
      "regional-outage",
      "Regional or provider outage",
      "A browser on one connection cannot establish the geographic scope or provider-wide cause of an outage.",
      "Check the provider's official status channel and compare another independent connection, such as cellular, without entering account credentials here.",
      "Do not report a regional outage from one failed browser test.",
    ),
  ];

  const prioritized = assessments
    .filter((item) => item.state === "supported" || (item.state === "possible" && item.confidence >= 35))
    .sort((a, b) => stateRank(a.state) - stateRank(b.state) || b.confidence - a.confidence);
  const fixPlan = prioritized.slice(0, 4).map((item) => ({
    title: item.action,
    reason: `${item.title}: ${item.evidence[0] ?? "more evidence is required"}`,
    verify: item.nextTest,
  }));
  if (fixPlan.length === 0) {
    fixPlan.push({
      title: "Run the recommended controlled comparison",
      reason: "The baseline establishes current performance but does not identify who or what caused it.",
      verify: nextComparisonForSymptom(session.symptom),
    });
  }

  const wireless = assessments.find((item) => item.id === "wireless-path");
  const purchaseGuidance =
    wireless?.state === "supported" && wireless.confidence >= 75
      ? "A wired access point or mesh system may help only if repeated near-router or Ethernet comparisons keep confirming a local wireless-path gap. First reposition existing equipment and retest; this evidence does not identify a specific product."
      : "No hardware purchase is justified by the current evidence. Complete the recommended comparison before replacing a router, modem, Wi-Fi system, or internet plan.";

  return {
    assessments,
    prioritized,
    fixPlan,
    purchaseGuidance,
    summary:
      prioritized.length > 0
        ? `${prioritized.filter((item) => item.state === "supported").length} supported and ${prioritized.filter((item) => item.state === "possible").length} possible finding(s) from ${session.runs.length} real run(s).`
        : `The ${session.runs.length}-run session has not isolated a likely cause yet.`,
  };
}

function assessBufferbloat(run: DiagnosticRun): CauseAssessment {
  const measurement = run.measurement;
  const worst = Math.max(measurement.bufferbloatDownMs, measurement.bufferbloatUpMs);
  const reliable = measurement.confidenceScore >= 55 && measurement.loadedDownSamples >= 2 && measurement.loadedUpSamples >= 2;
  const state: AssessmentState = worst >= 40 && reliable ? "supported" : worst >= 20 ? "possible" : "not-supported";
  return assessment({
    id: "bufferbloat",
    title: "Queueing under load (bufferbloat)",
    state,
    confidence: state === "not-supported" ? Math.min(measurement.confidenceScore, 80) : Math.min(measurement.confidenceScore, reliable ? 90 : 50),
    evidence: [
      `Download load added ${round(measurement.bufferbloatDownMs)} ms; upload load added ${round(measurement.bufferbloatUpMs)} ms versus ${round(measurement.idleLatencyMs)} ms idle latency.`,
      `${measurement.loadedDownSamples + measurement.loadedUpSamples} loaded-latency samples were recorded; run confidence was ${round(measurement.confidenceScore)}%.`,
    ],
    alternatives: ["The queue can be in the router, modem, access network, or provider path; this test does not locate its owner."],
    nextTest: "Pause other traffic, test over Ethernet, then repeat after enabling an existing SQM or smart-queue feature if available.",
    action: state === "supported" ? "Test SQM or smart queue management on existing equipment" : "Keep current queue settings and compare another controlled run",
    unlikelyToHelp: "A faster DNS resolver will not reduce measured loaded-latency queueing.",
    methodology: "max(loaded median − idle median) ≥ 40 ms is supported; 20–39 ms is possible. At least two samples per loaded direction and 55% run confidence are required for support.",
  });
}

function assessInstability(run: DiagnosticRun): CauseAssessment {
  const m = run.measurement;
  const state: AssessmentState = m.jitterMs >= 15 && m.confidenceScore >= 55 ? "supported" : m.jitterMs >= 8 || m.stabilityScore < 65 ? "possible" : "not-supported";
  return assessment({
    id: "latency-instability",
    title: "Latency instability",
    state,
    confidence: Math.min(m.confidenceScore, state === "supported" ? 85 : 65),
    evidence: [`Idle jitter was ${round(m.jitterMs)} ms and the measured stability score was ${round(m.stabilityScore)}/100.`],
    alternatives: ["Local wireless variation, competing traffic, the access link, and the endpoint path can produce similar samples."],
    nextTest: "Repeat once over Ethernet and once in the usual room without changing any other condition.",
    action: state === "supported" ? "Stabilize the local link and pause competing traffic, then retest" : "Collect a matched Ethernet comparison",
    unlikelyToHelp: "A plan upgrade is not justified until the source of the variation is isolated.",
    methodology: "Idle jitter ≥ 15 ms with ≥55% run confidence is supported; jitter ≥8 ms or stability <65 is possible.",
  });
}

function assessWireless(session: DiagnosticSession, baseline: DiagnosticRun): CauseAssessment {
  const comparisons = session.runs.filter((run) => run.kind === "near-router" || run.kind === "ethernet");
  const usable = comparisons.filter((run) => compatiblePair(baseline, run));
  const improved = usable.filter((run) => materialImprovement(baseline, run));
  const baselineWireless = baseline.conditions.link === "wifi";
  const state: AssessmentState =
    baselineWireless && improved.length > 0 ? "supported" : usable.length > 0 && baselineWireless ? "not-supported" : "possible";
  const best = improved.sort((a, b) => improvementScore(baseline, b) - improvementScore(baseline, a))[0];
  return assessment({
    id: "wireless-path",
    title: "Local Wi-Fi coverage or interference path",
    state,
    confidence: best ? pairConfidence(baseline, best, best.kind === "ethernet" ? 88 : 80) : usable.length ? pairConfidence(baseline, usable[0], 65) : 25,
    evidence: best
      ? comparisonEvidence(baseline, best)
      : [baselineWireless ? "No matched near-router or Ethernet run materially improved the baseline yet." : "The baseline was not confirmed as Wi-Fi, so NetPulse cannot attribute it to the wireless path."],
    alternatives: ["A device limit, background transfer, VPN, endpoint route, or access-link change can mimic a Wi-Fi improvement if other conditions changed."],
    nextTest: "Run beside the router on Wi-Fi and over Ethernet, keeping the device, endpoint, VPN, and background traffic the same.",
    action: state === "supported" ? "Reposition the existing access point and retest the affected room" : "Collect a controlled near-router or Ethernet pair",
    unlikelyToHelp: "Changing the internet plan will not repair a local wireless gap confirmed by an Ethernet comparison.",
    methodology: "Support requires a Wi-Fi baseline plus a compatible near-router/Ethernet run with a material throughput, latency, jitter, bufferbloat, or stability improvement.",
  });
}

function assessVpn(session: DiagnosticSession, baseline: DiagnosticRun): CauseAssessment {
  const candidate = session.runs.find((run) => run.kind === "vpn-off" && compatiblePair(baseline, run));
  const valid = baseline.conditions.vpn === "on" && candidate?.conditions.vpn === "off";
  const improved = Boolean(candidate && valid && materialImprovement(baseline, candidate));
  return pairedAssessment({
    id: "vpn-overhead",
    title: "VPN or proxy overhead",
    baseline,
    candidate,
    valid,
    improved,
    missingEvidence: "A VPN-on baseline and compatible VPN-off run have not both been recorded.",
    alternatives: ["The VPN exit route, encryption overhead, provider peering, or a simultaneous traffic change can each affect the pair."],
    nextTest: "Repeat VPN on and VPN off back-to-back using the same device, link, location, and endpoint.",
    action: improved ? "Use split tunneling or a nearer VPN exit when policy allows" : "Keep the VPN setting until a controlled pair shows a repeatable cost",
    unlikelyToHelp: "Replacing the router is unlikely to fix a result that changes only with VPN state.",
    methodology: "Support requires a confirmed VPN-on baseline, VPN-off comparison, compatible endpoint, ≥45% confidence per run, and material improvement.",
  });
}

function assessBackgroundTraffic(session: DiagnosticSession, baseline: DiagnosticRun): CauseAssessment {
  const candidate = session.runs.find((run) => run.kind === "background-paused" && compatiblePair(baseline, run));
  const valid = baseline.conditions.backgroundTraffic === "normal" && candidate?.conditions.backgroundTraffic === "paused";
  const improved = Boolean(candidate && valid && materialImprovement(baseline, candidate));
  return pairedAssessment({
    id: "background-traffic",
    title: "Competing background traffic",
    baseline,
    candidate,
    valid,
    improved,
    missingEvidence: "A normal-traffic baseline and compatible paused-traffic run have not both been recorded.",
    alternatives: ["Queue management, another household device, Wi-Fi contention, or normal run variation can produce a similar change."],
    nextTest: "Pause cloud sync, updates, streams, and large transfers on the network, then repeat immediately.",
    action: improved ? "Schedule large transfers or apply per-device traffic controls" : "Do not restrict household traffic without repeatable paired evidence",
    unlikelyToHelp: "Buying a higher-tier plan is premature if pausing known transfers has not been tested.",
    methodology: "Support requires normal-versus-paused conditions, compatible endpoint, ≥45% confidence per run, and material improvement.",
  });
}

function assessDevice(session: DiagnosticSession, baseline: DiagnosticRun): CauseAssessment {
  const candidate = session.runs.find((run) => run.kind === "other-device" && compatiblePair(baseline, run));
  const valid = baseline.conditions.device === "primary" && candidate?.conditions.device === "other";
  const improved = Boolean(candidate && valid && materialImprovement(baseline, candidate));
  return pairedAssessment({
    id: "device-browser",
    title: "Device or browser limitation",
    baseline,
    candidate,
    valid,
    improved,
    missingEvidence: "A compatible run from a second device has not been recorded in this local session.",
    alternatives: ["Different Wi-Fi radios, placement, browser scheduling, power state, or background applications can explain a device difference."],
    nextTest: "Place both devices together, use the same link and VPN state, close heavy apps, and run them one at a time.",
    action: improved ? "Update or inspect the affected device's browser, drivers, power mode, and background apps" : "Keep investigating the shared network path",
    unlikelyToHelp: "Replacing shared network equipment is unlikely to help if only one co-located device repeatedly underperforms.",
    methodology: "Support requires a materially better compatible run marked as another device; the comparison does not identify which device subsystem is responsible.",
  });
}

function assessGatewayState(session: DiagnosticSession, baseline: DiagnosticRun): CauseAssessment {
  const candidate = session.runs.find((run) => (run.kind === "router-restarted" || run.kind === "modem-restarted") && compatiblePair(baseline, run));
  const improved = Boolean(candidate && materialImprovement(baseline, candidate));
  return pairedAssessment({
    id: "gateway-state",
    title: "Temporary router or modem state",
    baseline,
    candidate,
    valid: Boolean(candidate),
    improved,
    missingEvidence: "No compatible post-restart run has been recorded.",
    alternatives: ["A new route, cleared background traffic, Wi-Fi reassociation, or ordinary variation can coincide with a restart."],
    nextTest: "If a restart helped, repeat the baseline later without restarting and record how long the improvement lasts.",
    action: improved ? "Document recurrence and check official firmware/support guidance" : "Avoid routine restarts as a substitute for isolating the cause",
    unlikelyToHelp: "Repeated rebooting is not a durable fix and does not prove hardware failure.",
    methodology: "A post-restart improvement is only possible evidence, never high-confidence ownership, because the restart changes several network conditions at once.",
    confidenceCap: 60,
  });
}

function assessPeakCongestion(session: DiagnosticSession): CauseAssessment {
  const peak = session.runs.find((run) => run.kind === "peak-time");
  const offPeak = session.runs.find((run) => run.kind === "off-peak");
  const valid = Boolean(peak && offPeak && compatiblePair(peak, offPeak));
  const improved = Boolean(peak && offPeak && valid && materialImprovement(peak, offPeak));
  return pairedAssessment({
    id: "peak-congestion",
    title: "Time-of-day congestion",
    baseline: peak,
    candidate: offPeak,
    valid,
    improved,
    missingEvidence: "Matched peak and off-peak runs are required; one time period cannot establish congestion.",
    alternatives: ["Household demand, Wi-Fi contention, routing changes, and provider shared-segment load can follow the same schedule."],
    nextTest: "Repeat peak and off-peak pairs over Ethernet on two different days while pausing household transfers.",
    action: improved ? "Collect repeated time-stamped pairs before contacting the provider" : "Do not attribute the issue to peak congestion yet",
    unlikelyToHelp: "A new router is unlikely to fix an Ethernet result that degrades only at repeatable peak times.",
    methodology: "Support requires compatible peak/off-peak runs and material off-peak improvement; confidence is capped until repeated on another day.",
    confidenceCap: 68,
  });
}

function assessIspAccess(session: DiagnosticSession): CauseAssessment {
  const planDown = session.planDownloadMbps;
  const planUp = session.planUploadMbps;
  const ethernet = session.runs.filter((run) => run.conditions.link === "ethernet" && run.measurement.confidenceScore >= 55);
  const diverse = new Set(ethernet.map((run) => `${run.conditions.device}:${run.conditions.time}`)).size >= 2;
  const underDown = planDown !== null && ethernet.length >= 2 && ethernet.every((run) => run.measurement.downloadMbps < planDown * 0.6);
  const underUp = planUp !== null && ethernet.length >= 2 && ethernet.every((run) => run.measurement.uploadMbps < planUp * 0.6);
  const state: AssessmentState = diverse && (underDown || underUp) ? "possible" : "unavailable";
  return assessment({
    id: "isp-access",
    title: "Plan, modem, access line, or ISP path limitation",
    state,
    confidence: state === "possible" ? Math.min(...ethernet.map((run) => run.measurement.confidenceScore), 65) : 0,
    evidence:
      state === "possible"
        ? [`${ethernet.length} confident Ethernet runs across ${new Set(ethernet.map((run) => run.conditions.device)).size} device label(s) remained below 60% of the entered plan rate.`]
        : ["NetPulse needs an entered plan rate plus at least two confident Ethernet runs across different device/time conditions before this becomes a candidate."],
    alternatives: ["Plan provisioning, modem negotiation, Ethernet adapter limits, provider congestion, and the single test endpoint remain separate possibilities."],
    nextTest: "Verify the subscribed rate on the bill, connect one capable device by Ethernet, repeat at peak and off-peak times, and compare a second documented provider.",
    action: state === "possible" ? "Save the repeated Ethernet evidence before contacting the provider" : "Collect plan-relative Ethernet evidence",
    unlikelyToHelp: "Do not buy a Wi-Fi system for a repeatable shortfall already present over Ethernet.",
    methodology: "Possible only when at least two ≥55%-confidence Ethernet runs from diverse device/time labels are each below 60% of an explicitly entered plan rate. NetPulse still cannot assign ownership.",
  });
}

function pairedAssessment(options: {
  id: CauseAssessment["id"];
  title: string;
  baseline?: DiagnosticRun;
  candidate?: DiagnosticRun;
  valid: boolean;
  improved: boolean;
  missingEvidence: string;
  alternatives: string[];
  nextTest: string;
  action: string;
  unlikelyToHelp: string;
  methodology: string;
  confidenceCap?: number;
}): CauseAssessment {
  const state: AssessmentState = options.improved ? "supported" : options.valid && options.candidate ? "not-supported" : "possible";
  const evidence = options.baseline && options.candidate && options.valid
    ? options.improved
      ? comparisonEvidence(options.baseline, options.candidate)
      : ["The controlled pair did not show a material improvement under the changed condition."]
    : [options.missingEvidence];
  const confidence = options.baseline && options.candidate && options.valid
    ? pairConfidence(options.baseline, options.candidate, options.confidenceCap ?? 85)
    : 20;
  return assessment({ ...options, state, confidence, evidence });
}

function unavailableAssessment(
  id: Extract<CauseAssessment["id"], "dns" | "route-server" | "packet-loss" | "regional-outage">,
  title: string,
  explanation: string,
  nextTest: string,
  unlikelyToHelp: string,
): CauseAssessment {
  return assessment({
    id,
    title,
    state: "unavailable",
    confidence: 0,
    evidence: [explanation],
    alternatives: ["Insufficient measurement evidence; no cause is assigned."],
    nextTest,
    action: "Use the specified independent measurement before drawing a conclusion",
    unlikelyToHelp,
    methodology: "No value is estimated or substituted while the required browser-safe measurement is unavailable.",
  });
}

function assessment(value: CauseAssessment): CauseAssessment {
  return value;
}

function compatiblePair(a: DiagnosticRun, b: DiagnosticRun): boolean {
  return (
    a.measurement.confidenceScore >= 45 &&
    b.measurement.confidenceScore >= 45 &&
    a.measurement.endpointProvider === b.measurement.endpointProvider &&
    a.measurement.endpointProtocol === b.measurement.endpointProtocol
  );
}

function materialImprovement(baseline: DiagnosticRun, candidate: DiagnosticRun): boolean {
  return improvementSignals(baseline, candidate).length >= 1;
}

function improvementSignals(baseline: DiagnosticRun, candidate: DiagnosticRun): string[] {
  const a = baseline.measurement;
  const b = candidate.measurement;
  const signals: string[] = [];
  if (b.downloadMbps >= a.downloadMbps * 1.35 && b.downloadMbps - a.downloadMbps >= 8) signals.push("download");
  if (b.uploadMbps >= a.uploadMbps * 1.35 && b.uploadMbps - a.uploadMbps >= 3) signals.push("upload");
  if (a.idleLatencyMs - b.idleLatencyMs >= 15 && b.idleLatencyMs <= a.idleLatencyMs * 0.75) signals.push("idle latency");
  if (a.jitterMs - b.jitterMs >= 5 && b.jitterMs <= a.jitterMs * 0.65) signals.push("jitter");
  const aBloat = Math.max(a.bufferbloatDownMs, a.bufferbloatUpMs);
  const bBloat = Math.max(b.bufferbloatDownMs, b.bufferbloatUpMs);
  if (aBloat - bBloat >= 20 && bBloat <= aBloat * 0.65) signals.push("loaded latency");
  if (b.stabilityScore - a.stabilityScore >= 15) signals.push("stability");
  return signals;
}

function improvementScore(baseline: DiagnosticRun, candidate: DiagnosticRun): number {
  return improvementSignals(baseline, candidate).length * 100 + candidate.measurement.confidenceScore;
}

function comparisonEvidence(baseline: DiagnosticRun, candidate: DiagnosticRun): string[] {
  const a = baseline.measurement;
  const b = candidate.measurement;
  const signals = improvementSignals(baseline, candidate);
  return [
    `${candidate.label} materially improved ${signals.join(", ")} versus ${baseline.label}.`,
    `Download ${format(a.downloadMbps)} → ${format(b.downloadMbps)} Mbps; upload ${format(a.uploadMbps)} → ${format(b.uploadMbps)} Mbps; idle latency ${round(a.idleLatencyMs)} → ${round(b.idleLatencyMs)} ms; jitter ${format(a.jitterMs)} → ${format(b.jitterMs)} ms.`,
    `Run confidence was ${round(a.confidenceScore)}% and ${round(b.confidenceScore)}%; both used ${a.endpointProvider} over ${a.endpointProtocol}.`,
  ];
}

function pairConfidence(a: DiagnosticRun, b: DiagnosticRun, cap: number): number {
  const endpointPenalty = a.measurement.endpointEdge && b.measurement.endpointEdge && a.measurement.endpointEdge !== b.measurement.endpointEdge ? 8 : 0;
  return Math.max(0, Math.min(a.measurement.confidenceScore, b.measurement.confidenceScore, cap) - endpointPenalty);
}

function stateRank(state: AssessmentState): number {
  return state === "supported" ? 0 : state === "possible" ? 1 : state === "not-supported" ? 2 : 3;
}

function nextComparisonForSymptom(symptom: DiagnosticSymptom): string {
  if (symptom === "offline") return "Confirm this device's link state, then compare another device and the provider's official status channel.";
  if (symptom === "slow-websites") return "Run a baseline, then compare Ethernet and another device before testing DNS outside the browser.";
  if (symptom === "intermittent" || symptom === "video-calls" || symptom === "gaming") return "Run the same test over Ethernet and in the usual Wi-Fi location.";
  return "Run beside the router and over Ethernet while keeping the same device, VPN state, and background traffic.";
}

function emptyEvaluation(): DiagnosticEvaluation {
  return {
    assessments: [],
    prioritized: [],
    fixPlan: [],
    purchaseGuidance: "No hardware purchase is justified without measured evidence.",
    summary: "Run a baseline to begin evidence-based troubleshooting.",
  };
}

function createId(prefix: string, now: number): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${now.toString(36)}`;
}

function round(value: number): number {
  return Math.round(value);
}

function format(value: number): string {
  return value >= 100 ? String(Math.round(value)) : value.toFixed(1);
}
