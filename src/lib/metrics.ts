/**
 * Metric definitions: name, meaning, measurement method, healthy ranges,
 * raw-sample selectors, and next-action logic for every metric card.
 *
 * Rules this file enforces:
 * - `value` returns null until the metric has genuinely been measured.
 * - A metric that CANNOT be measured from a browser sets `unavailable` with
 *   an honest explanation — it is never estimated or faked.
 * - `how` describes what the engine actually does (see src/lib/engine.ts),
 *   not a marketing paraphrase.
 */
import type { TestResult } from "./engine";

export type MetricSamples = { values: number[]; unit: string; caption: string };

export type MetricDef = {
  id: string;
  name: string;
  /** Set when the metric cannot be measured from a browser; explains why. */
  unavailable?: string;
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
  /** Engine phase during which this card should glow as "live". */
  hotPhase?: "download" | "upload" | "latency";
};

const fmt = (n: number) => (n >= 100 ? String(Math.round(n)) : n.toFixed(1));

const rtts = (r: TestResult, phase: "latency" | "download" | "upload") =>
  r.samples.filter((s) => s.phase === phase && s.rttMs !== undefined).map((s) => s.rttMs as number);

export const METRICS: MetricDef[] = [
  {
    id: "download",
    name: "Download speed",
    hotPhase: "download",
    value: (r) => (r.downloadMbps !== undefined ? `${fmt(r.downloadMbps)} Mbps` : null),
    what: "How much data your connection can pull down per second — the headline number ISPs advertise.",
    how: "Up to 3 parallel HTTPS streams (1 in low-data mode) download random bytes from speed.cloudflare.com for ~9 seconds. Throughput is sampled every 250 ms; the result is the median of the top half of samples, which ignores TCP ramp-up.",
    why: "Determines how fast pages, downloads, streams and updates arrive. Past ~100 Mbps, most everyday activities stop feeling faster — responsiveness (latency) takes over.",
    bands: [
      { range: "≥ 300 Mbps", label: "More than almost any household needs" },
      { range: "100–300 Mbps", label: "Excellent — 4K, gaming and backups in parallel" },
      { range: "25–100 Mbps", label: "Good for most use" },
      { range: "10–25 Mbps", label: "Workable — HD streaming OK, big downloads slow" },
      { range: "< 10 Mbps", label: "Slow — expect friction" },
    ],
    action: (r) =>
      r.downloadMbps < 25
        ? "Re-test over Ethernet next to the router. If it's still low, your plan or line is the limit — compare against what you're paying for."
        : r.bufferbloatGrade >= "C"
          ? "Bandwidth is fine. If things still feel slow, the problem is latency under load (see Bufferbloat), not download speed."
          : "No action needed — this is plenty for everyday use.",
    samples: (r) => {
      const values = r.samples.filter((s) => s.phase === "download" && s.mbps !== undefined).map((s) => s.mbps as number);
      return values.length ? { values, unit: "Mbps", caption: "250 ms throughput samples during the download phase" } : null;
    },
  },
  {
    id: "upload",
    name: "Upload speed",
    hotPhase: "upload",
    value: (r) => (r.uploadMbps !== undefined ? `${fmt(r.uploadMbps)} Mbps` : null),
    what: "How much data your connection can push out per second.",
    how: "Up to 2 parallel HTTPS POST streams (1 in low-data mode) send data to speed.cloudflare.com for ~7 seconds. Sampled every 250 ms; result is the median of the top half of samples.",
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
      const values = r.samples.filter((s) => s.phase === "upload" && s.mbps !== undefined).map((s) => s.mbps as number);
      return values.length ? { values, unit: "Mbps", caption: "250 ms throughput samples during the upload phase" } : null;
    },
  },
  {
    id: "idleLatency",
    name: "Idle latency",
    hotPhase: "latency",
    value: (r) => (r.idlePingMs !== undefined ? `${Math.round(r.idlePingMs)} ms` : null),
    what: "The round-trip time to the test server while your connection is quiet — the floor for how responsive anything can feel.",
    how: "10 timed zero-byte HTTPS requests to the nearest Cloudflare edge before any load starts; the result is the median. HTTP round-trips run slightly higher than raw ICMP ping.",
    why: "Every click, keystroke in a remote session, and game action pays this cost at minimum. No amount of bandwidth compensates for high base latency.",
    bands: [
      { range: "< 20 ms", label: "Excellent — competitive-gaming territory" },
      { range: "20–50 ms", label: "Good — nothing will feel laggy" },
      { range: "50–100 ms", label: "Noticeable in fast games and remote desktops" },
      { range: "≥ 100 ms", label: "Poor — likely VPN, satellite, congestion or a distant route" },
    ],
    action: (r) =>
      r.idlePingMs > 60
        ? "Check whether a VPN is active, and re-test on Ethernet. DSL and satellite links set a latency floor no router setting can fix."
        : "Healthy base latency — nothing to do here.",
    samples: (r) => {
      const values = rtts(r, "latency");
      return values.length ? { values, unit: "ms", caption: "Individual idle latency probes (median is the result)" } : null;
    },
  },
  {
    id: "dlLoaded",
    name: "Download-loaded latency",
    hotPhase: "download",
    value: (r) => (r.loadedDownPingMs !== undefined ? `${Math.round(r.loadedDownPingMs)} ms` : null),
    sub: (r) =>
      r.loadedDownPingMs !== undefined && r.idlePingMs !== undefined
        ? `+${Math.max(0, Math.round(r.loadedDownPingMs - r.idlePingMs))} ms vs idle`
        : null,
    what: "Your latency while the connection is busy downloading — game updates, streams, cloud sync.",
    how: "While the download streams saturate the line, a zero-byte probe runs every ~600 ms. The result is the median of those probes.",
    why: "If this balloons, everything lags whenever anything downloads: voice chops, games stutter, pages crawl. It's the number ordinary speed tests hide.",
    bands: [
      { range: "< 50 ms", label: "Excellent — stays responsive under load" },
      { range: "50–150 ms", label: "OK — light lag during heavy downloads" },
      { range: "150–400 ms", label: "Laggy — calls and games degrade when the line is busy" },
      { range: "≥ 400 ms", label: "Severe — the connection stalls under load" },
    ],
    action: (r) =>
      r.loadedDownPingMs - r.idlePingMs > 60
        ? "Enable SQM / Smart Queue Management (or QoS) on your router — it directly targets latency under load."
        : "Latency holds up under download load — good router queue behavior.",
    samples: (r) => {
      const values = rtts(r, "download");
      return values.length ? { values, unit: "ms", caption: "Latency probes taken during download saturation" } : null;
    },
  },
  {
    id: "ulLoaded",
    name: "Upload-loaded latency",
    hotPhase: "upload",
    value: (r) => (r.loadedUpPingMs !== undefined ? `${Math.round(r.loadedUpPingMs)} ms` : null),
    sub: (r) =>
      r.loadedUpPingMs !== undefined && r.idlePingMs !== undefined
        ? `+${Math.max(0, Math.round(r.loadedUpPingMs - r.idlePingMs))} ms vs idle`
        : null,
    what: "Your latency while the connection is busy uploading — backups, file sends, streaming out.",
    how: "While the upload streams saturate the line, a zero-byte probe runs every ~600 ms. The result is the median of those probes.",
    why: "Upload queues are usually smaller and choke first — this is the classic cause of 'the internet dies when someone backs up photos'.",
    bands: [
      { range: "< 50 ms", label: "Excellent — uploads don't hurt responsiveness" },
      { range: "50–150 ms", label: "OK — mild impact during big uploads" },
      { range: "150–400 ms", label: "Laggy — calls suffer while anything uploads" },
      { range: "≥ 400 ms", label: "Severe — uploads freeze everything else" },
    ],
    action: (r) =>
      r.loadedUpPingMs - r.idlePingMs > 60
        ? "Enable SQM/QoS on the router, or cap background upload tools (cloud backup, sync) to ~80% of your measured upload speed."
        : "Latency holds up under upload load — nothing to fix.",
    samples: (r) => {
      const values = rtts(r, "upload");
      return values.length ? { values, unit: "ms", caption: "Latency probes taken during upload saturation" } : null;
    },
  },
  {
    id: "jitter",
    name: "Jitter",
    hotPhase: "latency",
    value: (r) => (r.idleJitterMs !== undefined ? `${r.idleJitterMs.toFixed(1)} ms` : null),
    what: "How much your latency wobbles between consecutive probes — consistency, not speed.",
    how: "The mean absolute difference between consecutive idle latency probes (10 probes, taken before any load).",
    why: "Real-time audio and games buffer against your *worst* recent latency, not the average. Low jitter means smooth calls; high jitter means robotic audio even at good speeds.",
    bands: [
      { range: "< 5 ms", label: "Rock steady" },
      { range: "5–15 ms", label: "Fine for calls and gaming" },
      { range: "15–30 ms", label: "Shaky — occasional glitches in real-time apps" },
      { range: "≥ 30 ms", label: "Unstable — usually Wi-Fi interference or congestion" },
    ],
    action: (r) =>
      r.idleJitterMs > 15
        ? "On Wi-Fi, jitter this high usually means interference or weak signal — re-test next to the router or on Ethernet to isolate it."
        : "Latency is consistent — good for calls and gaming.",
    samples: (r) => {
      const values = rtts(r, "latency");
      return values.length ? { values, unit: "ms", caption: "Idle probes — jitter is the average step between neighbors" } : null;
    },
  },
  {
    id: "bufferbloat",
    name: "Bufferbloat",
    value: (r) =>
      r.bufferbloatGrade !== undefined && r.bufferbloatMs !== undefined
        ? `${r.bufferbloatGrade} (+${Math.round(r.bufferbloatMs)} ms)`
        : null,
    what: "How much your latency rises when the connection is fully busy — the single best predictor of a connection that 'feels slow despite fast speeds'.",
    how: "Derived from measurements: the worse of the two loaded-latency medians minus the idle median. Graded A (<30 ms rise) to F (≥200 ms).",
    why: "Oversized router buffers queue packets instead of pacing them. Grade C or worse means gaming, calls and browsing all degrade whenever anyone on the network downloads or uploads.",
    bands: [
      { range: "A — rise < 30 ms", label: "No meaningful bloat" },
      { range: "B — 30–60 ms", label: "Minor, rarely noticeable" },
      { range: "C — 60–100 ms", label: "Noticeable lag under load" },
      { range: "D — 100–200 ms", label: "Heavy lag under load" },
      { range: "F — ≥ 200 ms", label: "Connection stalls when busy" },
    ],
    action: (r) =>
      r.bufferbloatGrade >= "C"
        ? "Enable SQM (CAKE / fq_codel) or Smart Queue on your router — it's the direct fix. A faster plan will NOT fix bufferbloat."
        : "Your router queues traffic well — latency stays controlled under load.",
    samples: (r) => {
      const values = [...rtts(r, "download"), ...rtts(r, "upload")];
      return values.length ? { values, unit: "ms", caption: "All loaded-latency probes (download then upload phase)" } : null;
    },
  },
  {
    id: "stability",
    name: "Stability",
    value: (r) =>
      r.spikes !== undefined && r.probeCount !== undefined
        ? r.spikes === 0
          ? "Steady"
          : `${r.spikes} spike${r.spikes === 1 ? "" : "s"}`
        : null,
    sub: (r) => (r.probeCount !== undefined ? `${r.probeCount} probes under load` : null),
    what: "Whether latency stayed in a normal range during the whole test, or briefly shot up.",
    how: "Counts loaded-latency probes that exceeded 3× the idle median (or idle + 150 ms, whichever is larger). Derived entirely from the probes shown in the loaded-latency cards.",
    why: "Averages hide brief dropouts. A connection that spikes for two seconds every minute ruins calls and games while still posting good headline numbers.",
    bands: [
      { range: "0 spikes", label: "Steady throughout" },
      { range: "1–2 spikes", label: "Occasional wobble — usually harmless" },
      { range: "≥ 3 spikes", label: "Unstable under load — worth investigating" },
    ],
    action: (r) =>
      r.spikes >= 3
        ? "Run the Latency monitor for a few minutes during normal use — repeated spikes point to Wi-Fi interference or line trouble."
        : "No stability concerns in this test.",
    samples: (r) => {
      const values = [...rtts(r, "download"), ...rtts(r, "upload")];
      return values.length ? { values, unit: "ms", caption: "Loaded probes — spikes are the outliers far above the rest" } : null;
    },
  },
  {
    id: "packetLoss",
    name: "Packet loss",
    unavailable:
      "Browsers cannot send raw UDP or ICMP probes, and TCP hides retransmissions from JavaScript — a web page cannot measure packet loss honestly without dedicated server support. NetPulse shows nothing rather than an estimate.",
    value: () => null,
    what: "The percentage of packets that never arrive and must be re-sent.",
    how: "Not measured. It would require a UDP echo service (e.g. WebRTC data channels against a measurement server), which NetPulse does not yet have.",
    why: "Even 1–2% loss makes calls robotic and games rubber-band. It's a real and important metric — which is exactly why we won't fake it.",
    bands: [
      { range: "0%", label: "Perfect" },
      { range: "< 1%", label: "Fine for almost everything" },
      { range: "1–3%", label: "Calls and games degrade" },
      { range: "> 3%", label: "Something is wrong — line, Wi-Fi or hardware" },
    ],
    action: () =>
      "Measure it from your OS instead: open a terminal and run `ping -n 50 1.1.1.1` (Windows) or `ping -c 50 1.1.1.1` (macOS/Linux), then read the loss percentage.",
  },
  {
    id: "duration",
    name: "Test duration",
    value: (r) => (r.durationMs !== undefined ? `${(r.durationMs / 1000).toFixed(1)} s` : null),
    what: "How long the whole test took, wall-clock, from first latency probe to final result.",
    how: "Measured directly: performance.now() at test start vs. completion.",
    why: "Context for the other numbers — a full test saturates your line for ~16 s of this time, so other traffic during the window can influence results.",
    bands: [
      { range: "~20 s", label: "Typical full test" },
      { range: "4–12 s", label: "Low-data test — its byte caps end phases early on fast connections" },
    ],
    action: (r) =>
      r.lowData && r.durationMs < 8000
        ? "Your connection hit the low-data byte caps quickly, so load phases were short and latency-under-load numbers rest on few probes. Run a full test for more solid figures."
        : "Nothing to fix — if results look odd, re-run while nothing else uses the connection.",
  },
  {
    id: "dataUsed",
    name: "Data transferred",
    value: (r) => (r.dataUsedMB !== undefined ? `${r.dataUsedMB.toFixed(0)} MB` : null),
    what: "The real amount of data this test moved over your connection.",
    how: "Counted byte-by-byte from the download streams' readers and the upload bodies actually sent.",
    why: "Speed tests are data-hungry. On metered or capped connections this matters — that's why low-data mode exists.",
    bands: [
      { range: "100–400 MB", label: "Typical full test (scales with your speed)" },
      { range: "~35 MB", label: "Typical low-data test" },
    ],
    action: (r) =>
      r.lowData
        ? "You used low-data mode — results are slightly less precise but far cheaper on a capped plan."
        : "On a metered connection, switch on low-data mode in the sidebar before re-testing.",
  },
];
