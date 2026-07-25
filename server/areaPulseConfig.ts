export const AREA_PULSE_RETENTION_DAYS = 30;

export type AreaPulseRuntimeConfig = {
  hashSecret: string | null;
  turnstileSecret: string | null;
  turnstileSiteKey: string | null;
  expectedHostname: string | undefined;
  ingestToken: string | null;
  maintenanceToken: string | null;
};

export function areaPulseConfig(): AreaPulseRuntimeConfig {
  return {
    hashSecret: secret("AREA_PULSE_HASH_SECRET", 32),
    turnstileSecret: secret("TURNSTILE_SECRET_KEY", 20),
    turnstileSiteKey: publicValue("VITE_TURNSTILE_SITE_KEY", 100),
    expectedHostname: publicValue("AREA_PULSE_EXPECTED_HOSTNAME", 253) ?? undefined,
    ingestToken: secret("AREA_PULSE_INGEST_TOKEN", 32),
    maintenanceToken: secret("CRON_SECRET", 16) ?? secret("AREA_PULSE_MAINTENANCE_TOKEN", 32),
  };
}

function secret(name: string, minLength: number): string | null {
  const value = process.env[name]?.trim();
  return value && value.length >= minLength ? value : null;
}

function publicValue(name: string, maxLength: number): string | null {
  const value = process.env[name]?.trim();
  return value && value.length <= maxLength ? value : null;
}
