import { mkdir, writeFile } from "node:fs/promises";
import { chromium, firefox, webkit } from "playwright";

const browserName = required("NETPULSE_LAB_BROWSER");
const runId = required("NETPULSE_LAB_RUN_ID");
const condition = decodeJson("NETPULSE_LAB_CONDITION_B64");
const baseline = decodeJson("NETPULSE_LAB_BASELINE_B64");
const revision = required("NETPULSE_LAB_REVISION");
const outputDirectory = process.env.NETPULSE_LAB_RESULTS_DIR ?? "/results";
const appUrl = process.env.NETPULSE_LAB_URL ?? "http://app:5178";
const browserType = { chromium, firefox, webkit }[browserName];
if (!browserType) throw new Error(`Unsupported Playwright browser: ${browserName}`);

const browser = await browserType.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: "no-preference" });
const page = await context.newPage();
await page.addInitScript(() => {
  const metrics = { longTaskCount: 0, longTaskTotalMs: 0, maxFrameDelayMs: 0 };
  Object.defineProperty(window, "__NETPULSE_LAB_PERFORMANCE__", { value: metrics, configurable: false });
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        metrics.longTaskCount += 1;
        metrics.longTaskTotalMs += entry.duration;
      }
    });
    observer.observe({ type: "longtask", buffered: true });
  } catch {
    // Long Tasks is not implemented in every browser; the runner records null.
    metrics.longTaskCount = -1;
    metrics.longTaskTotalMs = -1;
  }
  let previous = performance.now();
  const sampleFrame = (now) => {
    metrics.maxFrameDelayMs = Math.max(metrics.maxFrameDelayMs, Math.max(0, now - previous - 16.667));
    previous = now;
    requestAnimationFrame(sampleFrame);
  };
  requestAnimationFrame(sampleFrame);
});

let record;
try {
  await waitForApp(page, appUrl);
  await page.getByRole("button", { name: /start test/i }).click();
  await page.waitForFunction(() => Boolean(window.__NETPULSE_LAB_RESULT__), null, { timeout: 180_000 });
  const captured = await page.evaluate(() => {
    const result = window.__NETPULSE_LAB_RESULT__;
    const performanceMetrics = window.__NETPULSE_LAB_PERFORMANCE__;
    const memory = performance.memory;
    return {
      result,
      performance: performanceMetrics,
      heapUsedBytes: typeof memory?.usedJSHeapSize === "number" ? memory.usedJSHeapSize : null,
    };
  });
  record = completeRecord(captured, await browser.version());
} catch (error) {
  record = failedRecord(error, await browser.version());
} finally {
  await browser.close();
}

await mkdir(outputDirectory, { recursive: true });
const outputPath = `${outputDirectory}/${safeFileName(runId)}.json`;
await writeFile(outputPath, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
process.stdout.write(`${JSON.stringify({ runId, status: record.outcome.status, outputPath })}\n`);
if (record.outcome.status !== "complete") process.exitCode = 1;

function completeRecord(captured, version) {
  const result = captured.result;
  if (!result) throw new Error("NetPulse completed without exposing a lab result.");
  const longTaskAvailable = captured.performance?.longTaskCount >= 0;
  return baseRecord(version, {
    status: "complete",
    downloadMbps: result.downloadMbps,
    uploadMbps: result.uploadMbps,
    idleLatencyMs: result.idlePingMs,
    jitterMs: result.idleJitterMs,
    bufferbloatDownMs: result.bufferbloat.downloadMs,
    bufferbloatUpMs: result.bufferbloat.uploadMs,
    confidenceScore: result.confidence.score,
    timeToStableMs: result.download.multi.stableAtMs,
    durationMs: result.durationMs,
    dataTransferredBytes: Math.round(result.dataUsedMB * 1_000_000),
    downloadFailed: false,
    uploadFailed: false,
    packetLossStatus: "unavailable",
    endpointHealthStatus: result.server.chosen.healthStatus,
    failureCode: null,
  }, {
    longTaskCount: longTaskAvailable ? captured.performance.longTaskCount : null,
    longTaskTotalMs: longTaskAvailable ? captured.performance.longTaskTotalMs : null,
    maxFrameDelayMs: captured.performance?.maxFrameDelayMs ?? null,
    heapUsedBytes: captured.heapUsedBytes,
    cpuUsagePct: null,
    unavailableReasons: [
      ...(longTaskAvailable ? [] : ["Long Tasks API is unavailable in this browser."]),
      ...(captured.heapUsedBytes === null ? ["JavaScript heap telemetry is unavailable in this browser."] : []),
      "Portable per-tab CPU usage is not exposed by browser APIs.",
    ],
  }, result.schemaVersion, result.server.directoryRevision);
}

function failedRecord(error, version) {
  const message = error instanceof Error ? error.message : "unknown_runner_failure";
  return baseRecord(version, {
    status: "failed",
    downloadMbps: null,
    uploadMbps: null,
    idleLatencyMs: null,
    jitterMs: null,
    bufferbloatDownMs: null,
    bufferbloatUpMs: null,
    confidenceScore: null,
    timeToStableMs: null,
    durationMs: 0,
    dataTransferredBytes: 0,
    downloadFailed: true,
    uploadFailed: true,
    packetLossStatus: "unavailable",
    endpointHealthStatus: "unknown",
    failureCode: message.replaceAll(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 160),
  }, {
    longTaskCount: null,
    longTaskTotalMs: null,
    maxFrameDelayMs: null,
    heapUsedBytes: null,
    cpuUsagePct: null,
    unavailableReasons: ["The browser run did not complete, so performance telemetry is incomplete."],
  }, 0, "unavailable");
}

function baseRecord(version, outcome, performanceMetrics, resultSchemaVersion, directoryRevision) {
  return {
    schemaVersion: 1,
    runId,
    startedAt: new Date().toISOString(),
    source: { kind: "controlled-lab", netPulseRevision: revision, resultSchemaVersion, directoryRevision, mode: "full-ui" },
    condition,
    environment: {
      browser: browserName,
      browserVersion: version,
      operatingSystem: "Linux Playwright container",
      deviceClass: "desktop",
      medium: "ethernet",
      ipVersion: "ipv4",
      tabState: "foreground",
      powerMode: "normal",
      cpuLoad: "normal",
      region: "controlled-local",
      endpointId: "controlled-lab",
    },
    baseline,
    outcome,
    performance: performanceMetrics,
  };
}

async function waitForApp(targetPage, url) {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await targetPage.goto(url, { waitUntil: "domcontentloaded", timeout: 5_000 });
      if (response?.ok()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw lastError ?? new Error("NetPulse app did not become ready.");
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function decodeJson(name) {
  const encoded = required(name);
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
}

function safeFileName(value) {
  const safe = value.replaceAll(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 160);
  if (!safe) throw new Error("Run ID cannot produce an empty file name.");
  return safe;
}
