/**
 * Packet-loss / UDP reachability probe — EXPERIMENTAL, and labeled as such.
 *
 * What this actually does: opens an RTCPeerConnection, gathers ICE candidates
 * against public STUN servers, and measures whether a server-reflexive (srflx)
 * candidate appears — i.e. whether UDP can leave your network and reach a STUN
 * server, plus the time it took.
 *
 * What it does NOT do: measure end-to-end packet loss. True loss requires a
 * sustained UDP flow against a cooperating echo/TURN server that we don't run
 * yet. So the loss percentage is deliberately reported as unavailable; the UDP
 * reachability + STUN RTT are offered as honest, related signals instead.
 */
import type { PacketLoss, TriState } from "./types";
import { MeasurementCancelledError, throwIfCancelled } from "./cancellation";

const STUN_SERVERS = [
  "stun:stun.cloudflare.com:3478",
  "stun:stun.l.google.com:19302",
];

const METHOD =
  "WebRTC ICE gathering against public STUN servers (UDP egress + srflx candidate timing). Not an end-to-end loss measurement.";

export async function probePacketLoss(timeoutMs = 6000, signal?: AbortSignal, echoUrl?: string | null): Promise<PacketLoss> {
  if (echoUrl?.startsWith("wss://") || echoUrl?.startsWith("ws://")) {
    try {
      return await probeWebSocketEcho(echoUrl, { timeoutMs, signal });
    } catch {
      throwIfCancelled(signal);
      // A failed optional echo must not suppress the independent UDP reachability signal.
    }
  }
  throwIfCancelled(signal);
  const RTC = (window as unknown as { RTCPeerConnection?: typeof RTCPeerConnection }).RTCPeerConnection;
  if (!RTC) {
    return {
      status: "unavailable",
      udpReachable: "unknown",
      stunRttMs: null,
      candidateTypes: [],
      transport: "unavailable",
      sent: null,
      received: null,
      late: null,
      reordered: null,
      packetLossPct: null,
      messageLossPct: null,
      durationMs: null,
      method: METHOD,
      note: "WebRTC is not available in this browser, so UDP reachability could not be checked.",
    };
  }

  const pc = new RTC({ iceServers: [{ urls: STUN_SERVERS }] });
  const types = new Set<string>();
  let stunRttMs: number | null = null;
  const start = performance.now();

  const result = await new Promise<TriState>((resolve, reject) => {
    let settled = false;
    const done = (state: TriState) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      // close() is idempotent for an RTCPeerConnection created above.
      pc.close();
      resolve(state);
    };
    const abort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pc.close();
      reject(new MeasurementCancelledError());
    };
    const timer = setTimeout(() => done(types.has("srflx") ? "yes" : types.size ? "no" : "unknown"), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }

    pc.onicecandidate = (e) => {
      if (!e.candidate) {
        // Gathering finished.
        done(types.has("srflx") ? "yes" : "no");
        return;
      }
      const type = e.candidate.type ?? parseType(e.candidate.candidate);
      if (type) types.add(type);
      if ((type === "srflx" || type === "relay") && stunRttMs === null) {
        stunRttMs = Math.round(performance.now() - start);
      }
    };
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === "complete") {
        done(types.has("srflx") ? "yes" : "no");
      }
    };

    // A data channel forces ICE gathering to begin.
    pc.createDataChannel("probe");
    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .catch(() => {
        if (signal?.aborted) {
          abort();
          return;
        }
        done("unknown");
      });
  });

  const udpReachable = result;
  const note =
    udpReachable === "yes"
      ? "UDP can leave your network and reached a STUN server — real-time apps (games, calls) should work. This is not a loss percentage."
      : udpReachable === "no"
        ? "No UDP reflexive candidate was found — UDP may be blocked (firewall/VPN). Real-time apps could fall back to TCP relays. Still not a loss percentage."
        : "UDP reachability could not be determined in this browser/session.";

  return {
    status: "experimental",
    udpReachable,
    stunRttMs,
    candidateTypes: [...types],
    transport: "webrtc-stun",
    sent: null,
    received: null,
    late: null,
    reordered: null,
    packetLossPct: null,
    messageLossPct: null,
    durationMs: Math.round(performance.now() - start),
    method: METHOD,
    note,
  };
}

export function summarizeEchoDelivery(input: {
  sent: number;
  receivedSequences: number[];
  lateSequences: Set<number>;
  durationMs: number;
}): Pick<PacketLoss, "sent" | "received" | "late" | "reordered" | "packetLossPct" | "messageLossPct" | "durationMs"> {
  const unique = [...new Set(input.receivedSequences.filter((sequence) => Number.isInteger(sequence) && sequence >= 0 && sequence < input.sent))];
  let reordered = 0;
  let highest = -1;
  for (const sequence of unique) {
    if (sequence < highest) reordered += 1;
    highest = Math.max(highest, sequence);
  }
  const received = unique.length;
  const lost = Math.max(0, input.sent - received);
  return {
    sent: input.sent,
    received,
    late: unique.filter((sequence) => input.lateSequences.has(sequence)).length,
    reordered,
    packetLossPct: null,
    messageLossPct: input.sent > 0 ? lost / input.sent * 100 : null,
    durationMs: input.durationMs,
  };
}

export async function probeWebSocketEcho(
  url: string,
  options: { timeoutMs?: number; intervalMs?: number; probes?: number; lateAfterMs?: number; signal?: AbortSignal } = {},
): Promise<PacketLoss> {
  throwIfCancelled(options.signal);
  if (typeof WebSocket === "undefined") throw new Error("WebSocket is unavailable in this browser.");
  const timeoutMs = options.timeoutMs ?? 6_000;
  const intervalMs = options.intervalMs ?? 100;
  const probes = options.probes ?? 20;
  const lateAfterMs = options.lateAfterMs ?? 500;
  const runId = `echo-${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(16)}`;
  const startedAt = performance.now();
  const sentAt = new Map<number, number>();
  const receivedSequences: number[] = [];
  const lateSequences = new Set<number>();

  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(url);
    let sent = 0;
    let settled = false;
    let sendTimer: ReturnType<typeof setInterval> | null = null;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      if (timeout !== null) clearTimeout(timeout);
      if (sendTimer !== null) clearInterval(sendTimer);
      if (graceTimer !== null) clearTimeout(graceTimer);
      options.signal?.removeEventListener("abort", abort);
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close(1000, "complete");
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const abort = () => fail(new MeasurementCancelledError());
    timeout = setTimeout(finish, timeoutMs);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) return abort();

    socket.onopen = () => {
      const send = () => {
        if (sent >= probes || socket.readyState !== WebSocket.OPEN) return;
        const sequence = sent++;
        const timestamp = performance.now();
        sentAt.set(sequence, timestamp);
        socket.send(JSON.stringify({ type: "netpulse-echo", runId, sequence, clientSentAt: timestamp }));
        if (sent >= probes) {
          if (sendTimer !== null) clearInterval(sendTimer);
          graceTimer = setTimeout(finish, Math.min(1_500, Math.max(500, timeoutMs / 3)));
        }
      };
      send();
      sendTimer = setInterval(send, intervalMs);
    };
    socket.onmessage = (event) => {
      try {
        const parsed: unknown = JSON.parse(String(event.data));
        if (!isEchoResponse(parsed, runId)) return;
        if (receivedSequences.includes(parsed.sequence)) return;
        receivedSequences.push(parsed.sequence);
        const original = sentAt.get(parsed.sequence);
        if (original !== undefined && performance.now() - original > lateAfterMs) lateSequences.add(parsed.sequence);
        if (receivedSequences.length >= probes) finish();
      } catch {
        // Malformed or unrelated messages are ignored and never counted as probes.
      }
    };
    socket.onerror = () => fail(new Error("Controlled WebSocket echo failed."));
    socket.onclose = () => {
      if (!settled && sent < probes) fail(new Error("Controlled WebSocket echo closed before all probes were sent."));
    };
  });

  const summary = summarizeEchoDelivery({ sent: sentAt.size, receivedSequences, lateSequences, durationMs: performance.now() - startedAt });
  return {
    status: "experimental",
    udpReachable: "unknown",
    stunRttMs: null,
    candidateTypes: [],
    transport: "websocket-echo",
    ...summary,
    method: "Controlled WebSocket application-message echo over reliable TCP.",
    note: `The controlled echo delivered ${summary.received}/${summary.sent} application messages. TCP retransmits hidden network packet loss, so ${summary.messageLossPct?.toFixed(1) ?? "unavailable"}% is message-delivery loss, not a packet-loss percentage.`,
  };
}

function isEchoResponse(value: unknown, runId: string): value is { type: string; runId: string; sequence: number } {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.type === "netpulse-echo" && record.runId === runId && typeof record.sequence === "number" && Number.isInteger(record.sequence);
}

function parseType(candidate: string): string | null {
  const m = /typ (\w+)/.exec(candidate);
  return m ? m[1] : null;
}
