import { areaPulseConfig } from "../../server/areaPulseConfig";
import { AreaPulseDuplicateError, AreaPulseRateLimitError, AreaPulseStorageError, createAreaReport, deleteAreaReport } from "../../server/areaPulseDb";
import { json, limitedJsonBody, RequestBodyError } from "../../server/areaPulseHttp";
import { coarseRegionFromRequest, deletionTokenHash, privacyKey, transientRequestIp } from "../../server/areaPulsePrivacy";
import { providerKey, validateAreaReport } from "../../server/areaPulseValidation";
import { verifyTurnstile } from "../../server/turnstile";

export async function POST(request: Request): Promise<Response> {
  const config = areaPulseConfig();
  const region = coarseRegionFromRequest(request);
  const ip = transientRequestIp(request);
  if (!config.hashSecret || !config.turnstileSecret || !config.turnstileSiteKey || !config.expectedHostname || !region || !ip) return json({ error: "Anonymous reporting infrastructure is unavailable.", code: "reporting-unavailable" }, 503);
  try {
    const validation = validateAreaReport(await limitedJsonBody(request));
    if (!validation.ok) return json({ error: validation.error, code: "invalid-report" }, 400);
    const turnstile = await verifyTurnstile({ token: validation.value.turnstileToken, remoteIp: ip, secret: config.turnstileSecret, expectedHostname: config.expectedHostname });
    if (!turnstile.ok) return json({ error: turnstile.reason, code: "verification-failed" }, 400);
    const reporterKey = privacyKey(config.hashSecret, "reporter", ip);
    const provider = providerKey(validation.value.isp, validation.value.asn);
    const duplicateKey = privacyKey(config.hashSecret, "duplicate", `${reporterKey}|${region.key}|${provider}|${validation.value.kind}|${validation.value.service?.toLowerCase() ?? ""}`);
    const deletionToken = crypto.randomUUID();
    const id = crypto.randomUUID();
    await createAreaReport({ id, input: validation.value, region, reporterKey, duplicateKey, deletionTokenHash: deletionTokenHash(deletionToken), actorKey: privacyKey(config.hashSecret, "audit", ip) });
    return json({ id, deletionToken, region, message: "Anonymous report accepted. It will not become a public incident unless the minimum independent-report threshold is met." }, 201);
  } catch (error) {
    if (error instanceof RequestBodyError) return json({ error: error.message, code: "invalid-json" }, 400);
    if (error instanceof AreaPulseDuplicateError) return json({ error: error.message, code: "duplicate" }, 409);
    if (error instanceof AreaPulseRateLimitError) return json({ error: error.message, code: "rate-limited" }, 429, { "Retry-After": "3600" });
    const message = error instanceof AreaPulseStorageError ? error.message : "Anonymous reporting is unavailable.";
    return json({ error: message, code: "storage-unavailable" }, 503);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const config = areaPulseConfig();
  const ip = transientRequestIp(request);
  if (!config.hashSecret || !ip) return json({ error: "Deletion infrastructure is unavailable.", code: "deletion-unavailable" }, 503);
  try {
    const body = await limitedJsonBody(request, 4096);
    if (!isDeleteBody(body)) return json({ error: "A valid report id and deletion token are required.", code: "invalid-delete" }, 400);
    const deleted = await deleteAreaReport(body.id, deletionTokenHash(body.deletionToken), privacyKey(config.hashSecret, "audit", ip));
    return deleted ? json({ deleted: true }) : json({ error: "Report not found or deletion token invalid.", code: "not-found" }, 404);
  } catch (error) {
    if (error instanceof RequestBodyError) return json({ error: error.message, code: "invalid-json" }, 400);
    return json({ error: "Deletion infrastructure is unavailable.", code: "storage-unavailable" }, 503);
  }
}

function isDeleteBody(value: unknown): value is { id: string; deletionToken: string } {
  return typeof value === "object" && value !== null && !Array.isArray(value) && typeof Reflect.get(value, "id") === "string" && /^[0-9a-f-]{36}$/.test(Reflect.get(value, "id")) && typeof Reflect.get(value, "deletionToken") === "string" && /^[0-9a-f-]{36}$/.test(Reflect.get(value, "deletionToken"));
}
