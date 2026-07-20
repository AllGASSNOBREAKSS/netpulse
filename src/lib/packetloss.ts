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

const STUN_SERVERS = [
  "stun:stun.cloudflare.com:3478",
  "stun:stun.l.google.com:19302",
];

const METHOD =
  "WebRTC ICE gathering against public STUN servers (UDP egress + srflx candidate timing). Not an end-to-end loss measurement.";

export async function probePacketLoss(timeoutMs = 6000): Promise<PacketLoss> {
  const RTC = (window as unknown as { RTCPeerConnection?: typeof RTCPeerConnection }).RTCPeerConnection;
  if (!RTC) {
    return {
      status: "unavailable",
      udpReachable: "unknown",
      stunRttMs: null,
      candidateTypes: [],
      method: METHOD,
      note: "WebRTC is not available in this browser, so UDP reachability could not be checked.",
    };
  }

  const pc = new RTC({ iceServers: [{ urls: STUN_SERVERS }] });
  const types = new Set<string>();
  let stunRttMs: number | null = null;
  const start = performance.now();

  const result = await new Promise<TriState>((resolve) => {
    let settled = false;
    const done = (state: TriState) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // close() is idempotent for an RTCPeerConnection created above.
      pc.close();
      resolve(state);
    };
    const timer = setTimeout(() => done(types.has("srflx") ? "yes" : types.size ? "no" : "unknown"), timeoutMs);

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
      .catch(() => done("unknown"));
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
    method: METHOD,
    note,
  };
}

function parseType(candidate: string): string | null {
  const m = /typ (\w+)/.exec(candidate);
  return m ? m[1] : null;
}
