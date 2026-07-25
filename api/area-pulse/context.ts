import { AREA_PULSE_MIN_REPORTS } from "../../src/lib/areaPulse";
import { AREA_PULSE_RETENTION_DAYS, areaPulseConfig } from "../../server/areaPulseConfig";
import { areaPulseDatabaseConfigured } from "../../server/areaPulseDb";
import { json } from "../../server/areaPulseHttp";
import { coarseRegionFromRequest, transientRequestIp } from "../../server/areaPulsePrivacy";

export function GET(request: Request): Response {
  const config = areaPulseConfig();
  const region = coarseRegionFromRequest(request);
  const database = areaPulseDatabaseConfigured();
  const ipAvailable = transientRequestIp(request) !== null;
  const available = database && region !== null;
  const reportingAvailable = available && ipAvailable && Boolean(config.hashSecret && config.turnstileSecret && config.turnstileSiteKey && config.expectedHostname);
  const reasons = [
    !database ? "The regional database is not configured." : null,
    !region ? "A sufficiently coarse Vercel IP-based region is unavailable." : null,
    !ipAvailable ? "A transient request address is unavailable for private rate limiting." : null,
    !config.hashSecret ? "The privacy-key secret is not configured." : null,
    !config.turnstileSecret || !config.turnstileSiteKey ? "Turnstile is not configured." : null,
    !config.expectedHostname ? "The expected production hostname is not configured." : null,
  ].filter((reason): reason is string => Boolean(reason));
  return json({
    available,
    reportingAvailable,
    reason: reasons.length ? reasons.join(" ") : null,
    region,
    turnstileSiteKey: reportingAvailable ? config.turnstileSiteKey : null,
    retentionDays: AREA_PULSE_RETENTION_DAYS,
    minimumReports: AREA_PULSE_MIN_REPORTS,
    locationNotice: "Region is an approximate city, subdivision, or country derived by Vercel from the request IP. Exact coordinates and full IP addresses are never returned or stored by NetPulse.",
  });
}
