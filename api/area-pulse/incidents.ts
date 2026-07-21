import { buildAreaPulseSnapshot } from "../../server/areaPulseAggregation";
import { loadAreaPulseRegion, AreaPulseStorageError } from "../../server/areaPulseDb";
import { json } from "../../server/areaPulseHttp";
import { coarseRegionFromRequest } from "../../server/areaPulsePrivacy";

export async function GET(request: Request): Promise<Response> {
  const region = coarseRegionFromRequest(request);
  if (!region) return json({ error: "A sufficiently coarse approximate region is unavailable.", code: "region-unavailable" }, 422);
  try {
    const data = await loadAreaPulseRegion(region);
    return json(buildAreaPulseSnapshot({ region, ...data }), 200, { "Cache-Control": "private, max-age=30" });
  } catch (error) {
    const message = error instanceof AreaPulseStorageError ? error.message : "Area Pulse is unavailable.";
    return json({ error: message, code: "storage-unavailable" }, 503);
  }
}
