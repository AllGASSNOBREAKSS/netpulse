import { areaPulseConfig } from "../../server/areaPulseConfig";
import { AreaPulseStorageError, cleanupAreaPulse } from "../../server/areaPulseDb";
import { bearerToken, json } from "../../server/areaPulseHttp";
import { safeSecretEqual } from "../../server/areaPulsePrivacy";

export async function GET(request: Request): Promise<Response> {
  const config = areaPulseConfig();
  const supplied = bearerToken(request);
  if (!config.maintenanceToken || !supplied || !safeSecretEqual(config.maintenanceToken, supplied)) return json({ error: "Unauthorized." }, 401);
  try {
    return json({ cleaned: await cleanupAreaPulse() });
  } catch (error) {
    const message = error instanceof AreaPulseStorageError ? error.message : "Area Pulse maintenance is unavailable.";
    return json({ error: message }, 503);
  }
}
