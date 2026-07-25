import { areaPulseConfig } from "../../server/areaPulseConfig";
import { AreaPulseStorageError, claimAdminNonce, upsertProviderMessage } from "../../server/areaPulseDb";
import { json, limitedJsonText, RequestBodyError } from "../../server/areaPulseHttp";
import { validateProviderMessage } from "../../server/areaPulseValidation";
import { verifySignedAdminRequest } from "../../server/signedRequest";

export async function POST(request: Request): Promise<Response> {
  const config = areaPulseConfig();
  if (!config.ingestToken) return json({ error: "Provider ingestion is unavailable." }, 503);
  try {
    const body = await limitedJsonText(request, 32_768);
    const signature = verifySignedAdminRequest({ request, body, secret: config.ingestToken });
    if (!signature.ok) return json({ error: signature.error }, 401);
    if (!await claimAdminNonce(signature.nonce, signature.actorKey)) return json({ error: "Signed request nonce has already been used." }, 409);
    let parsed: unknown;
    try { parsed = JSON.parse(body) as unknown; } catch { return json({ error: "Request body must be valid JSON." }, 400); }
    const validation = validateProviderMessage(parsed);
    if (!validation.ok) return json({ error: validation.error, code: "invalid-provider-message" }, 400);
    await upsertProviderMessage(validation.value, signature.actorKey);
    return json({ accepted: true, id: validation.value.id }, 201);
  } catch (error) {
    if (error instanceof RequestBodyError) return json({ error: error.message, code: "invalid-json" }, 400);
    const message = error instanceof AreaPulseStorageError ? error.message : "Provider-message ingestion is unavailable.";
    return json({ error: message, code: "storage-unavailable" }, 503);
  }
}
