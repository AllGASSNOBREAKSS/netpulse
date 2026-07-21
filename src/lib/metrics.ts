/**
 * Metric definitions: name, meaning, measurement method, healthy ranges,
 * raw-sample selectors, and next-action logic for every metric card.
 *
 * Rules this file enforces:
 * - `value` returns null until the metric has genuinely been measured.
 * - A metric that CANNOT be measured from a browser sets `unavailable` with
 *   an honest explanation — it is never estimated or faked.
 * - `how` describes what the engine actually does (see src/lib/*.ts), not a
 *   marketing paraphrase.
 */
import type { TestResult } from "./engine";
import { percentile } from "./stats";

export type MetricSamples = { values: number[]; unit: string; caption: string };

export type MetricDef = {
  id: string;
  name: string;
  provenance: "measured" | "calculated" | "experimental";
  /** Set when the metric cannot be measured from a browser; explains why. */
  unavailable?: string;
  /** "experimental" adds an honest badge without claiming a hard number. */
  experimental?: boolean;
  /** Formatted result, or null when not yet measured. Accepts live partials. */
  value: (r: Partial<TestResult>) => string | null;
  /** Extra line under the card value (optional). */
  sub?: (r: Partial<TestResult>) => string | null;
  what: string;
  how: string;
  why: string;
  bands: { range: string; label: string }[];
  action: (r: TestResult) => string;
  samples?: (r: TestResult) => MetricSamples | null;
  /** Engine phase-prefix during which this card should glow as "live". */
  hotPhase?: "download" | "upload" | "latency";
};

const fmt = (n: number) => (n >= 100 ? String(Math.round(n)) : n.toFixed(1));

const DL_PHASES = ["download_single", "download_multi"];
const rttsOf = (r: TestResult, phases: string[]) =>
  r.samples.filter((s) => phases.includes(s.phase) && s.rttMs !== undefined).map((s) => s.rttMs as number);
const mbpsOf = (r: TestResult, phases: string[]) =>
  r.samples.filter((s) => phases.includes(s.phase) && s.mbps !== undefined).map((s) => s.mbps as number);

export const METRICS: MetricDef[] = [
  {
    id: "download",
    name: "Download speed",
    provenance: "measured",
    hotPhase: "download",
    value: (r) => (r.downloadMbps !== undefined ? `${fmt(r.downloadMbps)} Mbps` : null),
    sub: (r) =>
      r.download ? `aggregate ${fmt(r.download.multi.mbps)} · p90 ${fmt(percentile(r.download.multi.samples, 90) || r.download.multi.mbps)} · variation ${r.download.multi.variationPct.toFixed(1)}%` : null,
    what: "How much data your connection can pull down per second — the headline number ISPs advertise.",
    how: "A discarded warm-up transfer primes DNS/TLS and chooses an adaptive request payload. NetPulse then runs one HTTPS stream followed by up to four parallel streams (two in low-data mode). Every request is cache-busted and no-store. The headline is measured application payload divided by actual phase time; 250 ms windows provide median, 90th-percentile capacity context, peak, and variation. The load stops only after its minimum duration and steady sampling, or at the duration/data cap.",
    why: "Determines how fast pages, downloads, streams and updates arrive. The gap between single and multi connection speed hints at whether a single flow is being shaped. Past ~100 Mbps, responsiveness (latency) matters more than raw speed.",
    bands: [
      { range: "≥ 300 Mbps", label: "More than almost any household needs" },
      { range: "100–300 Mbps", label: "Excellent — 4K, gaming and backups in parallel" },
      { range: "25–100 Mbps", label: "Good for most use" },
      { range: "10–25 Mbps", label: "Workable — HD streaming OK, big downloads slow" },
      { range: "< 10 Mbps", label: "Slow — expect friction" },
    ],
    action: (r) =>
      r.downloadMbps < 25
        ? "Re-test over Ethernet next to the router. If it remains low, compare with the plan rate and another endpoint; this run alone cannot distinguish local Wi-Fi, routing, plan, or access-line limits."
        : r.bufferbloatGrade >= "C"
          ? "Bandwidth is fine. If things still feel slow, the problem is latency under load (see Bufferbloat), not download speed."
          : "No action needed — this is plenty for everyday use.",
    samples: (r) => {
      const values = mbpsOf(r, DL_PHASES);
      return values.length ? { values, unit: "Mbps", caption: "Timed throughput windows (~250 ms, plus the final partial window; single then multi connection)" } : null;
    },
  },
  {
    id: "upload",
    name: "Upload speed",
    provenance: "measured",
    hotPhase: "upload",
    value: (r) => (r.uploadMbps !== undefined ? `${fmt(r.uploadMbps)} Mbps` : null),
    sub: (r) =>
      r.upload ? `median ${fmt(r.upload.medianMbps)} · peak obs. ${fmt(r.upload.peakMbps)} · variation ${r.upload.variationPct.toFixed(1)}%` : null,
    what: "How much data your connection can push out per second.",
    how: "A discarded generated-payload warm-up primes the route and chooses an adaptive POST size. Up to three parallel HTTPS POST streams (one in low-data mode) then send non-personal, non-compressible bytes from memory. Reliable throughput is server-accepted payload divided by actual phase time. Fetch exposes neither byte-level upload progress nor wire overhead, so median, peak observation, and variation use cumulative accepted-payload observations and are labeled accordingly.",
    why: "Video calls, livestreaming, cloud backups and sending files all depend on upload. Many cable plans are heavily asymmetric — a fraction of the download figure.",
    bands: [
      { range: "≥ 50 Mbps", label: "Excellent — streaming and backups without thinking" },
      { range: "20–50 Mbps", label: "Good — calls, sharing and sync are comfortable" },
      { range: "5–20 Mbps", label: "OK — one call is fine, parallel uploads will squeeze it" },
      { range: "< 5 Mbps", label: "Weak — calls and backups will feel it" },
    ],
    action: (r) =>
      r.uploadMbps < 5
        ? "Check the upload speed your plan actually promises — asymmetric plans are common, and this may be all you're paying for."
        : "Healthy. If calls still stutter while uploading, look at Upload-loaded latency instead.",
    samples: (r) => {
      const values = r.upload.samples;
      return values.length ? { values, unit: "Mbps", caption: "Cumulative accepted-payload observations; Fetch does not expose byte-level upload windows" } : null;
    },
  },
  {
    id: "idleLatency",
    name: "Idle latency",
    provenance: "measured",
    hotPhase: "latency",
    value: (r) => (r.idlePingMs !== undefined ? `${Math.round(r.idlePingMs)} ms` : null),
    sub: (r) => (r.idleLatency ? `p95 ${Math.round(r.idleLatency.p95)} · min ${Math.round(r.idleLatency.min)} ms · n=${r.idleLatency.count}` : null),
    what: "The round-trip time to the test server while your connection is quiet — the floor for how responsive anything can feel.",
    how: "14 timed zero-byte HTTPS requests (10 in low-data mode) to the selected server before any load, timed with performance.now() (monotonic, sub-ms). The result is the median; min/mean/p95/p99/jitter are also computed. HTTP round-trips run slightly higher than raw ICMP ping.",
    why: "Every click, keystroke in a remote session, and game action pays this cost at minimum. No amount of bandwidth compensates for high base latency.",
    bands: [
      { range: "< 20 ms", label: "Excellent — competitive-gaming territory" },
      { range: "20–50 ms", label: "Good — nothing will feel laggy" },
      { range: "50–100 ms", label: "Noticeable in fast games and remote desktops" },
      { range: "≥ 100 ms", label: "Poor — consistent with a distant route, VPN, or high-latency access path" },
    ],
    action: (r) =>
      r.idlePingMs > 60
        ? "If a VPN is active, compare one run without it and one over Ethernet. The browser cannot identify the access technology or exact cause."
        : "Healthy base latency — nothing to do here.",
    samples: (r) => {
      const values = rttsOf(r, ["latency"]);
      return values.length ? { values, unit: "ms", caption: "Individual idle latency probes (median is the result)" } : null;
    },
  },
  {
    id: "dlLoaded",
    name: "Download-loaded latency",
    provenance: "measured",
    hotPhase: "download",
    value: (r) => (r.loadedDownPingMs !== undefined ? `${Math.round(r.loadedDownPingMs)} ms` : null),
    sub: (r) =>
      r.loadedDownPingMs !== undefined && r.idlePingMs !== undefined
        ? `+${Math.max(0, Math.round(r.loadedDownPingMs - r.idlePingMs))} ms vs idle${r.loadedDown ? ` · n=${r.loadedDown.count}` : ""}`
        : null,
    what: "Your latency while the connection is busy downloading — game updates, streams, cloud sync.",
    how: "While the download streams saturate the line, a zero-byte probe runs every ~500 ms. The result is the median of those probes.",
    why: "If this balloons, everything lags whenever anything downloads: voice chops, games stutter, pages crawl. It's the number ordinary speed tests hide.",
    bands: [
      { range: "< 50 ms", label: "Excellent — stays responsive under load" },
      { range: "50–150 ms", label: "OK — light lag during heavy downloads" },
      { range: "150–400 ms", label: "Laggy — calls and games degrade when the line is busy" },
      { range: "≥ 400 ms", label: "Severe — the connection stalls under load" },
    ],
    action: (r) =>
      r.loadedDownPingMs - r.idlePingMs > 60
        ? "Test SQM / Smart Queue Management if your router supports it, then re-run. The measured rise is consistent with queueing, but this browser cannot locate the queue."
        : "Latency holds up under download load — good router queue behavior.",
    samples: (r) => {
      const values = rttsOf(r, DL_PHASES);
      return values.length ? { values, unit: "ms", caption: "Latency probes taken during download saturation" } : null;
    },
  },
  {
    id: "ulLoaded",
    name: "Upload-loaded latency",
    provenance: "measured",
    hotPhase: "upload",
    value: (r) => (r.loadedUpPingMs !== undefined ? `${Math.round(r.loadedUpPingMs)} ms` : null),
    sub: (r) =>
      r.loadedUpPingMs !== undefined && r.idlePingMs !== undefined
        ? `+${Math.max(0, Math.round(r.loadedUpPingMs - r.idlePingMs))} ms vs idle${r.loadedUp ? ` · n=${r.loadedUp.count}` : ""}`
        : null,
    what: "Your latency while the connection is busy uploading — backups, file sends, streaming out.",
    how: "While the upload streams saturate the line, a zero-byte probe runs every ~500 ms. The result is the median of those probes.",
    why: "Upload queues are usually smaller and choke first — this is the classic cause of 'the internet dies when someone backs up photos'.",
    bands: [
      { range: "< 50 ms", label: "Excellent — uploads don't hurt responsiveness" },
      { range: "50–150 ms", label: "OK — mild impact during big uploads" },
      { range: "150–400 ms", label: "Laggy — calls suffer while anything uploads" },
      { range: "≥ 400 ms", label: "Severe — uploads freeze everything else" },
    ],
    action: (r) =>
      r.loadedUpPingMs - r.idlePingMs > 60
        ? "Test SQM/QoS if available, or temporarily cap a background uploader near 80% of this measured rate and re-run to see whether loaded latency falls."
        : "Latency holds up under upload load — nothing to fix.",
    samples: (r) => {
      const values = rttsOf(r, ["upload"]);
      return values.length ? { values, unit: "ms", caption: "Latency probes taken during upload saturation" } : null;
    },
  },
  {
    id: "jitter",
    name: "Jitter",
    provenance: "calculated",
    hotPhase: "latency",
    value: (r) => (r.idleJitterMs !== undefined ? `${r.idleJitterMs.toFixed(1)} ms` : null),
    what: "How much your latency wobbles between consecutive probes — consistency, not speed.",
    how: "The mean absolute difference between consecutive idle latency probes (before any load).",
    why: "Real-time audio and games buffer against your *worst* recent latency, not the average. Low jitter means smooth calls; high jitter means robotic audio even at good speeds.",
    bands: [
      { range: "< 5 ms", label: "Rock steady" },
      { range: "5–15 ms", label: "Fine for calls and gaming" },
      { range: "15–30 ms", label: "Shaky — occasional glitches in real-time apps" },
      { range: "≥ 30 ms", label: "Unstable — local-link or route investigation warranted" },
    ],
    action: (r) =>
      r.idleJitterMs > 15
        ? "Possible local-link or route instability: compare Ethernet and Wi-Fi runs. The browser cannot identify interference or signal strength."
        : "Latency is consistent — good for calls and gaming.",
    samples: (r) => {
      const values = rttsOf(r, ["latency"]);
      return values.length ? { values, unit: "ms", caption: "Idle probes — jitter is the average step between neighbors" } : null;
    },
  },
  {
    id: "packetLoss",
    name: "Packet loss",
    provenance: "experimental",
    experimental: true,
    unavailable: "A browser needs a cooperating UDP echo endpoint to measure end-to-end packet loss. NetPulse does not operate one yet, so no loss percentage is shown.",
    value: () => null,
    sub: (r) =>
      r.packetLoss
        ? `UDP reachability: ${r.packetLoss.udpReachable} (experimental)`
        : "Measurement unavailable in this browser",
    what: "The percentage of packets that never reach their destination or never return. NetPulse does not infer this from unrelated signals.",
    how: "Direct packet loss is unavailable in the current browser test. Separately, an experimental WebRTC STUN probe checks whether UDP egress can reach a public STUN server. UDP reachability is not an end-to-end loss percentage and is never presented as one.",
    why: "Even 1–2% real loss can make calls robotic and games rubber-band. That is why an unavailable result is more useful than an invented percentage.",
    bands: [
      { range: "0%", label: "No loss observed during a valid test" },
      { range: "< 1%", label: "Usually acceptable for real-time use" },
      { range: "1–2%", label: "Calls and games may degrade" },
      { range: "> 2%", label: "Material connection instability" },
    ],
    action: () =>
      "For a real loss figure, measure from your OS: `ping -n 50 1.1.1.1` (Windows) or `ping -c 50 1.1.1.1` (macOS/Linux) and read the loss percentage.",
  },
  {
    id: "bufferbloat",
    name: "Bufferbloat",
    provenance: "calculated",
    value: (r) =>
      r.bufferbloatGrade !== undefined && r.bufferbloatMs !== undefined
        ? `${r.bufferbloatGrade} (+${Math.round(r.bufferbloatMs)} ms)`
        : null,
    sub: (r) =>
      r.bufferbloat ? `down ${r.bufferbloat.downloadGrade} · up ${r.bufferbloat.uploadGrade}` : null,
    what: "How much your latency rises when the connection is fully busy — the single best predictor of a connection that 'feels slow despite fast speeds'.",
    how: "Measured, not guessed: for download and upload separately, the loaded-latency median minus the idle median. Graded A (<30 ms rise) to F (≥200 ms); the overall grade is the worse of the two.",
    why: "Queues in a router, modem, access network, or provider path can hold packets instead of pacing them. Grade C or worse means this test observed responsiveness degradation during saturation; it does not identify which device owns the queue.",
    bands: [
      { range: "A — rise < 30 ms", label: "No meaningful bloat" },
      { range: "B — 30–60 ms", label: "Minor, rarely noticeable" },
      { range: "C — 60–100 ms", label: "Noticeable lag under load" },
      { range: "D — 100–200 ms", label: "Heavy lag under load" },
      { range: "F — ≥ 200 ms", label: "Connection stalls when busy" },
    ],
    action: (r) =>
      r.bufferbloatGrade >= "C"
        ? "If supported, test SQM (CAKE / fq_codel) or Smart Queue and re-run. A faster tier alone is not evidence that queueing will improve."
        : "Your router queues traffic well — latency stays controlled under load.",
    samples: (r) => {
      const values = [...rttsOf(r, DL_PHASES), ...rttsOf(r, ["upload"])];
      return values.length ? { values, unit: "ms", caption: "All loaded-latency probes (download then upload phase)" } : null;
    },
  },
  {
    id: "stability",
    name: "Stability",
    provenance: "calculated",
    value: (r) => (r.stability ? `${r.stability.score}/100` : null),
    sub: (r) =>
      r.stability
        ? `${r.stability.spikes} spike${r.stability.spikes === 1 ? "" : "s"} · σ ${r.stability.latencyStddevMs} ms · ${(r.stability.completeness * 100).toFixed(0)}% probes`
        : null,
    what: "A 0–100 score for how steady latency stayed during load — averages hide brief dropouts, this doesn't.",
    how: "Starts at 100 and subtracts weighted penalties for loaded-latency spread (30%), spike ratio (30%), worse download/upload throughput variation (20%), failed probes or requests (15%), and test completion (5%). A spike exceeds the larger of 3× idle or idle+150 ms. P95, P99, longest spike, and probe completeness remain visible.",
    why: "A connection that spikes for two seconds every minute ruins calls and games while still posting good headline numbers.",
    bands: [
      { range: "85–100", label: "Steady throughout" },
      { range: "60–85", label: "Occasional wobble — usually harmless" },
      { range: "< 60", label: "Unstable under load — worth investigating" },
    ],
    action: (r) =>
      (r.stability?.score ?? 100) < 60
        ? "Run the Latency monitor for a few minutes during normal use — repeated spikes point to Wi-Fi interference or line trouble."
        : "No stability concerns in this test.",
    samples: (r) => {
      const values = [...rttsOf(r, DL_PHASES), ...rttsOf(r, ["upload"])];
      return values.length ? { values, unit: "ms", caption: "Loaded probes — spikes are the outliers far above the rest" } : null;
    },
  },
  {
    id: "duration",
    name: "Test duration",
    provenance: "measured",
    value: (r) => (r.durationMs !== undefined ? `${(r.durationMs / 1000).toFixed(1)} s` : null),
    what: "How long the whole test took, wall-clock, from preflight to final result.",
    how: "Measured directly: performance.now() at test start vs. completion.",
    why: "Context for the other numbers — the load phases saturate your line for part of this time, so other traffic during the window can influence results.",
    bands: [
      { range: "~34 s", label: "Typical full test" },
      { range: "~20 s", label: "Typical low-data test" },
    ],
    action: (r) =>
      r.lowData && r.durationMs < 18000
        ? "Your connection hit the low-data caps quickly, so load phases were short. Run a full test for more solid figures."
        : "Nothing to fix — if results look odd, re-run while nothing else uses the connection.",
  },
  {
    id: "dataUsed",
    name: "Data transferred",
    provenance: "measured",
    value: (r) => (r.dataUsedMB !== undefined ? `${r.dataUsedMB.toFixed(0)} MB` : null),
    what: "The application payload NetPulse observed during this test.",
    how: "Counted byte-by-byte from download stream readers and from upload bodies after the server accepted each request. Browser APIs do not expose protocol overhead or the portion of an upload aborted mid-request, so this is measured payload, not exact on-wire usage.",
    why: "Speed tests are data-hungry. On metered or capped connections this matters — that's why low-data mode exists.",
    bands: [
      { range: "100–350 MB", label: "Typical full test (scales with your speed)" },
      { range: "~40 MB", label: "Typical low-data test" },
    ],
    action: (r) =>
      r.lowData
        ? "You used low-data mode — results are slightly less precise but far cheaper on a capped plan."
        : "On a metered connection, switch on low-data mode in the sidebar before re-testing.",
  },
];
