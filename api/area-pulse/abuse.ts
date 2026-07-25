import { areaPulseConfig } from "../../server/areaPulseConfig";
import { AreaPulseAbuseLimitError, AreaPulseDuplicateError, AreaPulseStorageError, createAbuseReport } from "../../server/areaPulseDb";
import { json, limitedJsonBody, RequestBodyError } from "../../server/areaPulseHttp";
import { privacyKey, transientRequestIp } from "../../server/areaPulsePrivacy";
import { validateAbuseReport } from "../../server/areaPulseValidation";
import { verifyTurnstile } from "../../server/turnstile";

export async function POST(request: Request): Promise<Response> {
  const config = areaPulseConfig();
  const ip = transientRequestIp(request);
  if (!config.hashSecret || !config.turnstileSecret || !config.expectedHostname || !ip) return json({ error: "Abuse reporting is unavailable.", code: "reporting-unavailable" }, 503);
  try {
    const validation = validateAbuseReport(await limitedJsonBody(request, 8_192));
    if (!validation.ok) return json({ error: validation.error, code: "invalid-abuse-report" }, 400);
    const turnstile = await verifyTurnstile({ token: validation.value.turnstileToken, remoteIp: ip, secret: config.turnstileSecret, expectedHostname: config.expectedHostname, expectedAction: "area-pulse-abuse" });
    if (!turnstile.ok) return json({ error: turnstile.reason, code: "verification-failed" }, 400);
    const actorKey = privacyKey(config.hashSecret, "abuse-actor", ip);
    const duplicateKey = privacyKey(config.hashSecret, "abuse-duplicate", `${actorKey}|${validation.value.incidentId}|${validation.value.reason}`);
    await createAbuseReport(validation.value, actorKey, duplicateKey);
    return json({ accepted: true }, 201);
  } catch (error) {
    if (error instanceof RequestBodyError) return json({ error: error.message, code: "invalid-json" }, 400);
    if (error instanceof AreaPulseDuplicateError) return json({ error: error.message, code: "duplicate" }, 409);
    if (error instanceof AreaPulseAbuseLimitError) return json({ error: error.message, code: "rate-limited" }, 429, { "Retry-After": "86400" });
    const message = error instanceof AreaPulseStorageError ? error.message : "Abuse reporting is unavailable.";
    return json({ error: message, code: "storage-unavailable" }, 503);
  }
}
