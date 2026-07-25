import { evaluateDiagnostic, SYMPTOMS, type DiagnosticSession } from "./diagnostics";

export function createPrivacySafeDiagnosticReport(session: DiagnosticSession): string {
  const evaluation = evaluateDiagnostic(session);
  const symptom = SYMPTOMS.find((item) => item.id === session.symptom)?.label ?? session.symptom;
  const lines = [
    "NetPulse privacy-safe troubleshooting report",
    `Generated: ${new Date().toISOString()}`,
    `Session: ${session.id}`,
    `Symptom: ${symptom}`,
    `Runs: ${session.runs.length}`,
    `Plan reference: ${session.planDownloadMbps ?? "not entered"} Mbps down / ${session.planUploadMbps ?? "not entered"} Mbps up`,
    "",
    "MEASURED RUNS",
  ];
  for (const run of session.runs) {
    const m = run.measurement;
    lines.push(
      `- ${run.label} — ${new Date(run.measuredAt).toISOString()}`,
      `  Conditions: ${run.conditions.link}, ${run.conditions.location}, VPN ${run.conditions.vpn}, traffic ${run.conditions.backgroundTraffic}, ${run.conditions.device} device, ${run.conditions.time}`,
      `  Throughput: ${format(m.downloadMbps)} Mbps down / ${format(m.uploadMbps)} Mbps up`,
      `  Latency: ${Math.round(m.idleLatencyMs)} ms idle / ${Math.round(m.loadedDownMs)} ms download-loaded / ${Math.round(m.loadedUpMs)} ms upload-loaded / ${format(m.jitterMs)} ms jitter`,
      `  Bufferbloat: +${Math.round(m.bufferbloatDownMs)} ms down / +${Math.round(m.bufferbloatUpMs)} ms up; stability ${Math.round(m.stabilityScore)}/100`,
      `  Evidence: ${m.idleSamples} idle, ${m.loadedDownSamples} download-loaded, ${m.loadedUpSamples} upload-loaded samples; ${(m.durationMs / 1000).toFixed(1)} s; ${m.dataUsedMB.toFixed(1)} MB; confidence ${Math.round(m.confidenceScore)}%`,
      `  Endpoint: ${m.endpointProvider} ${m.endpointEdge ?? "edge unavailable"} · ${m.endpointProtocol} · observed ${m.observedIpFamily}`,
      "  Packet loss: unavailable (UDP reachability is not packet loss)",
    );
  }
  lines.push("", "EVIDENCE ASSESSMENTS");
  for (const item of evaluation.assessments) {
    lines.push(
      `- ${item.title}: ${item.state}; confidence ${item.confidence}%`,
      ...item.evidence.map((evidence) => `  Evidence: ${evidence}`),
      `  Alternative: ${item.alternatives.join(" ")}`,
      `  Next test: ${item.nextTest}`,
      `  Action: ${item.action}`,
      `  Unlikely to help: ${item.unlikelyToHelp}`,
    );
  }
  lines.push("", "PRIORITIZED FIX PLAN");
  evaluation.fixPlan.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.title}`, `   Why: ${item.reason}`, `   Verify: ${item.verify}`);
  });
  lines.push(
    "",
    "PURCHASE GUIDANCE",
    evaluation.purchaseGuidance,
    "",
    "PRIVACY",
    "This report contains summarized measurements and user-selected test conditions. It excludes full public IP addresses, SSIDs, device names, browsing history, and credentials.",
    "",
    "LIMITATIONS",
    "Browser measurements cannot inspect router state, Wi-Fi signal/channel use, recursive DNS performance, true end-to-end packet loss, or regional outage scope. A supported impairment is not automatically proof of which device or provider owns the cause.",
  );
  return lines.join("\n");
}

export function downloadPrivacySafeDiagnosticReport(session: DiagnosticSession): void {
  const blob = new Blob([createPrivacySafeDiagnosticReport(session)], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `netpulse-diagnostic-${new Date(session.createdAt).toISOString().slice(0, 10)}.txt`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function format(value: number): string {
  return value >= 100 ? String(Math.round(value)) : value.toFixed(1);
}
