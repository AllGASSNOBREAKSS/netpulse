import { createServer } from "node:http";
import { createSocket } from "node:dgram";
import { createHash, randomFillSync } from "node:crypto";

const PORT = 8080;
const MAX_CONCURRENT = boundedEnv("NETPULSE_MAX_CONCURRENT_TESTS", 32, 1, 256);
const MAX_DOWNLOAD_BYTES = boundedEnv("NETPULSE_MAX_DOWNLOAD_BYTES", 268_435_456, 1, 1_073_741_824);
const MAX_UPLOAD_BYTES = boundedEnv("NETPULSE_MAX_UPLOAD_BYTES", 67_108_864, 1, 268_435_456);
const VERSION = "netpulse-lab-endpoint/1.0.0";
const PAYLOAD = randomFillSync(Buffer.allocUnsafe(1024 * 1024));
let activeRequests = 0;
let activeEchoConnections = 0;

const server = createServer(async (request, response) => {
  setCommonHeaders(response);
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "endpoint"}`);
  try {
    if (url.pathname === "/directory.json" && request.method === "GET") return sendJson(response, directory(request));
    if (url.pathname === "/v1/health" && request.method === "GET") return sendJson(response, health());
    if (url.pathname === "/v1/latency" && request.method === "GET") {
      response.writeHead(204, { "Content-Length": "0" });
      response.end();
      return;
    }
    if (url.pathname === "/v1/download" && request.method === "GET") return streamDownload(url, response);
    if (url.pathname === "/v1/upload" && request.method === "POST") return receiveUpload(request, response);
    sendJson(response, { error: "not_found" }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : "request_failed";
    sendJson(response, { error: message }, 500);
  }
});

server.keepAliveTimeout = 15_000;
server.headersTimeout = 20_000;
server.requestTimeout = 120_000;
server.on("upgrade", handleWebSocketUpgrade);
server.listen(PORT, "0.0.0.0");

const udp = createSocket("udp4");
udp.on("message", (message, remote) => udp.send(message, remote.port, remote.address));
udp.bind(9000, "0.0.0.0");

function streamDownload(url, response) {
  const bytes = boundedQuery(url.searchParams.get("bytes"), 0, MAX_DOWNLOAD_BYTES);
  if (activeRequests >= MAX_CONCURRENT) return sendJson(response, { error: "over_capacity" }, 503);
  activeRequests += 1;
  response.writeHead(200, {
    "Content-Type": "application/octet-stream",
    "Content-Length": String(bytes),
    "Content-Encoding": "identity",
  });
  let remaining = bytes;
  const release = once(() => { activeRequests = Math.max(0, activeRequests - 1); });
  response.on("close", release);
  response.on("finish", release);
  const write = () => {
    while (remaining > 0) {
      const chunk = PAYLOAD.subarray(0, Math.min(remaining, PAYLOAD.length));
      remaining -= chunk.length;
      if (!response.write(chunk)) {
        response.once("drain", write);
        return;
      }
    }
    response.end();
  };
  write();
}

function receiveUpload(request, response) {
  if (activeRequests >= MAX_CONCURRENT) return sendJson(response, { error: "over_capacity" }, 503);
  activeRequests += 1;
  let bytes = 0;
  const release = once(() => { activeRequests = Math.max(0, activeRequests - 1); });
  request.on("data", (chunk) => {
    bytes += chunk.length;
    if (bytes > MAX_UPLOAD_BYTES) request.destroy(new Error("upload_too_large"));
  });
  request.on("end", () => {
    release();
    sendJson(response, { acceptedBytes: bytes });
  });
  request.on("close", release);
  request.on("error", (error) => {
    release();
    if (!response.headersSent) sendJson(response, { error: error.message }, 413);
  });
}

function directory(request) {
  const forwardedHost = request.headers["x-forwarded-host"];
  const host = typeof forwardedHost === "string" ? forwardedHost : "shaper:8080";
  const origin = `http://${host}`;
  return {
    schemaVersion: 1,
    revision: "controlled-lab-endpoint-v1",
    publishedAt: new Date().toISOString(),
    coverage: [{ id: "controlled-local", label: "Controlled local lab", status: "pilot", note: "Isolated test network only; not public regional coverage." }],
    endpoints: [{
      id: "controlled-lab",
      provider: "NetPulse isolated validation lab",
      regionId: "controlled-local",
      regionLabel: "Controlled local lab",
      city: null,
      countryCode: null,
      status: "pilot",
      protocol: "HTTP fetch inside isolated Docker network",
      protocolVersion: 1,
      downloadUrlTemplate: `${origin}/v1/download?bytes={bytes}`,
      uploadUrl: `${origin}/v1/upload`,
      latencyUrl: `${origin}/v1/latency`,
      traceUrl: null,
      healthUrl: `${origin}/v1/health`,
      echoUrl: `ws://${host}/v1/echo`,
      capabilities: { download: true, upload: true, latency: true, echo: true, ipv4: true, ipv6: false, health: true, capacity: false, version: true },
    }],
  };
}

function health() {
  const now = Date.now();
  const activeTests = activeRequests + activeEchoConnections;
  const loadPct = Math.min(100, (activeTests / MAX_CONCURRENT) * 100);
  return {
    status: loadPct >= 90 ? "degraded" : "healthy",
    checkedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 15_000).toISOString(),
    loadPct,
    capacityMbps: null,
    availableCapacityMbps: null,
    activeTests,
    maxConcurrentTests: MAX_CONCURRENT,
    serverVersion: VERSION,
    protocolVersion: 1,
    reason: loadPct >= 90 ? "Concurrent-request limit is nearly exhausted." : "Process is responsive; bandwidth capacity is deliberately not inferred.",
  };
}

function sendJson(response, value, status = 200) {
  const body = JSON.stringify(value);
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": String(Buffer.byteLength(body)) });
  response.end(body);
}

function setCommonHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Expose-Headers", "Server-Timing,X-NetPulse-Transport,X-NetPulse-Tcp-Rtt-Ms,X-NetPulse-Quic-Rtt-Ms,X-NetPulse-Retransmits");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-NetPulse-Transport", "tcp");
  response.setHeader("Server-Timing", "endpoint;dur=0");
}

function handleWebSocketUpgrade(request, socket) {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "endpoint"}`);
  const key = request.headers["sec-websocket-key"];
  if (url.pathname !== "/v1/echo" || typeof key !== "string" || activeEchoConnections >= MAX_CONCURRENT) {
    socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
  socket.write([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "",
    "",
  ].join("\r\n"));
  activeEchoConnections += 1;
  let pending = Buffer.alloc(0);
  const release = once(() => { activeEchoConnections = Math.max(0, activeEchoConnections - 1); });
  socket.on("close", release);
  socket.on("error", release);
  socket.on("data", (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    for (;;) {
      const parsed = readWebSocketFrame(pending);
      if (!parsed) break;
      pending = pending.subarray(parsed.bytesConsumed);
      if (parsed.opcode === 0x8) {
        socket.end(writeWebSocketFrame(Buffer.alloc(0), 0x8));
        return;
      }
      if (parsed.opcode === 0x9) {
        socket.write(writeWebSocketFrame(parsed.payload, 0xA));
        continue;
      }
      if (parsed.opcode !== 0x1) continue;
      try {
        const message = JSON.parse(parsed.payload.toString("utf8"));
        if (message?.type !== "netpulse-echo" || typeof message.runId !== "string" || !Number.isInteger(message.sequence)) continue;
        const serverReceivedAt = performance.now();
        const response = Buffer.from(JSON.stringify({
          type: "netpulse-echo",
          runId: message.runId.slice(0, 100),
          sequence: message.sequence,
          clientSentAt: typeof message.clientSentAt === "number" ? message.clientSentAt : null,
          serverReceivedAt,
          serverSentAt: performance.now(),
        }));
        socket.write(writeWebSocketFrame(response));
      } catch {
        // Invalid messages are ignored and do not become measurement evidence.
      }
    }
  });
}

function readWebSocketFrame(buffer) {
  if (buffer.length < 2) return null;
  const opcode = buffer[0] & 0x0f;
  const masked = (buffer[1] & 0x80) !== 0;
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return null;
    const large = buffer.readBigUInt64BE(2);
    if (large > 65_535n) throw new Error("echo_frame_too_large");
    length = Number(large);
    offset = 10;
  }
  if (!masked) throw new Error("client_frame_must_be_masked");
  if (buffer.length < offset + 4 + length) return null;
  const mask = buffer.subarray(offset, offset + 4);
  offset += 4;
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
  return { opcode, payload, bytesConsumed: offset + length };
}

function writeWebSocketFrame(payload, opcode = 0x1) {
  if (payload.length < 126) return Buffer.concat([Buffer.from([0x80 | opcode, payload.length]), payload]);
  const header = Buffer.allocUnsafe(4);
  header[0] = 0x80 | opcode;
  header[1] = 126;
  header.writeUInt16BE(payload.length, 2);
  return Buffer.concat([header, payload]);
}

function boundedEnv(name, fallback, min, max) {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new Error(`${name} is outside the supported range.`);
  return Math.floor(parsed);
}

function boundedQuery(value, min, max) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new Error("invalid_byte_count");
  return Math.floor(parsed);
}

function once(callback) {
  let called = false;
  return () => {
    if (called) return;
    called = true;
    callback();
  };
}
