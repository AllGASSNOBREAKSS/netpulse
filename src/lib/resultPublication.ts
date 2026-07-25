import type {
  Confidence,
  DirectionCapacity,
  ResultPublication,
  ThroughputMetricPublication,
} from "./types";

const CURRENT_ORIGIN_DISCLOSURES = [
  "This test uses one Cloudflare anycast measurement origin.",
  "Independent endpoint verification is not yet available.",
  "Routing and endpoint conditions can influence results.",
] as const;

export function buildResultPublication(input: {
  confidence: Confidence;
  download: DirectionCapacity;
  upload: DirectionCapacity;
}): ResultPublication {
  const labels: ResultPublication["labels"] = [];
  if (input.confidence.score < 60) labels.push("Low-confidence estimate.");
  if (hasQuickEstimate(input.download) || hasQuickEstimate(input.upload)) {
    labels.push("Quick estimate.");
  }

  const download = copyMetric(input.download.publication.maximum);
  const upload = copyMetric(input.upload.publication.maximum);
  const anyInconclusive = download.status === "inconclusive" || upload.status === "inconclusive";
  const anyQuick = hasQuickEstimate(input.download) || hasQuickEstimate(input.upload);
  const outcome: ResultPublication["outcome"] = anyInconclusive
    ? "inconclusive"
    : anyQuick
      ? "quick-estimate"
      : input.confidence.score < 60
        ? "low-confidence"
        : "complete-with-limitations";
  const outcomeReasons = [
    ...(input.confidence.score < 60 ? [`Confidence was ${input.confidence.score}%, below the 60% publication threshold.`] : []),
    ...(anyQuick ? ["At least one throughput product did not satisfy full duration, data, sample, ramp, or endpoint qualification."] : []),
    ...(anyInconclusive ? ["At least one headline throughput metric had no semantically consistent qualified evidence."] : []),
    ...download.reasons,
    ...upload.reasons,
    "Independent endpoint verification is not currently available.",
  ];

  return {
    accuracyCertified: false,
    labels,
    outcome,
    outcomeReasons: [...new Set(outcomeReasons)],
    download,
    upload,
    disclosures: [...CURRENT_ORIGIN_DISCLOSURES],
  };
}

export function publishedMbps(metric: ThroughputMetricPublication): number | null {
  return metric.status === "inconclusive" ? null : metric.valueMbps;
}

function hasQuickEstimate(direction: DirectionCapacity): boolean {
  return Object.values(direction.publication).some((value) =>
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    value.status === "quick-estimate"
  );
}

function copyMetric(metric: ThroughputMetricPublication): ThroughputMetricPublication {
  return {
    status: metric.status,
    valueMbps: publishedMbps(metric),
    reasons: [...metric.reasons],
  };
}
