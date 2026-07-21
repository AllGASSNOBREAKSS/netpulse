import postgres from "postgres";
import type { AreaPulseReportInput, CoarseRegion, OfficialProviderMessage } from "../src/lib/areaPulse";
import type { HistoricalBucket, StoredAreaReport } from "./areaPulseAggregation";
import type { ValidAbuseReport, ValidProviderMessage } from "./areaPulseValidation";
import { providerKey } from "./areaPulseValidation";

const REPORT_RETENTION_DAYS = 30;
let client: ReturnType<typeof postgres> | null = null;

export class AreaPulseStorageError extends Error {}
export class AreaPulseRateLimitError extends Error {}
export class AreaPulseDuplicateError extends Error {}
export class AreaPulseAbuseLimitError extends Error {}

export type NewAreaReport = {
  id: string;
  input: AreaPulseReportInput;
  region: CoarseRegion;
  reporterKey: string;
  duplicateKey: string;
  deletionTokenHash: string;
  actorKey: string;
};

export function areaPulseDatabaseConfigured(): boolean {
  return Boolean(databaseUrl());
}

export async function createAreaReport(report: NewAreaReport): Promise<void> {
  const sql = database();
  const provider = providerKey(report.input.isp, report.input.asn);
  const expiryHours = report.input.kind === "complete_outage" || report.input.kind === "intermittent" ? 12 : 24;
  try {
    await sql.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${report.reporterKey}, 0))`;
      const hourly = await transaction<{ count: number }[]>`
        SELECT count(*)::int AS count FROM area_pulse_reports
        WHERE reporter_key = ${report.reporterKey} AND created_at > now() - interval '1 hour'
      `;
      const daily = await transaction<{ count: number }[]>`
        SELECT count(*)::int AS count FROM area_pulse_reports
        WHERE reporter_key = ${report.reporterKey} AND created_at > now() - interval '24 hours'
      `;
      if ((hourly[0]?.count ?? 0) >= 5 || (daily[0]?.count ?? 0) >= 20) throw new AreaPulseRateLimitError("Anonymous report limit reached. Try again later.");
      const duplicate = await transaction<{ exists: boolean }[]>`
        SELECT EXISTS(
          SELECT 1 FROM area_pulse_reports
          WHERE duplicate_key = ${report.duplicateKey} AND created_at > now() - interval '30 minutes'
        ) AS exists
      `;
      if (duplicate[0]?.exists) throw new AreaPulseDuplicateError("A matching report was already received recently.");
      await transaction`
        INSERT INTO area_pulse_reports (
          id, expires_at, report_kind, provider_key, isp_display, asn,
          region_key, region_label, region_level, country_code, service_name,
          note, reporter_key, duplicate_key, deletion_token_hash, measurement,
          identity_provenance, abuse_score
        ) VALUES (
          ${report.id}, now() + (${expiryHours} * interval '1 hour'), ${report.input.kind}, ${provider}, ${report.input.isp}, ${report.input.asn},
          ${report.region.key}, ${report.region.label}, ${report.region.level}, ${report.region.countryCode}, ${report.input.service},
          ${report.input.note}, ${report.reporterKey}, ${report.duplicateKey}, ${report.deletionTokenHash}, ${report.input.measurement ? JSON.stringify(report.input.measurement) : null},
          ${report.input.identityConsent ? "user-consented" : "unavailable"}, 0
        )
      `;
      await transaction`
        INSERT INTO area_pulse_audit_log (id, expires_at, action, actor_key, target_id, outcome, metadata)
        VALUES (${crypto.randomUUID()}, now() + interval '30 days', 'report.create', ${report.actorKey}, ${report.id}, 'accepted', ${JSON.stringify({ kind: report.input.kind, regionLevel: report.region.level, identity: report.input.identityConsent })})
      `;
    });
  } catch (error) {
    if (error instanceof AreaPulseRateLimitError || error instanceof AreaPulseDuplicateError) throw error;
    throw new AreaPulseStorageError("Area Pulse storage is unavailable.");
  }
}

export async function deleteAreaReport(id: string, deletionHash: string, actorKey: string): Promise<boolean> {
  try {
    const sql = database();
    return await sql.begin(async (transaction) => {
      const removed = await transaction<{ id: string }[]>`
        DELETE FROM area_pulse_reports WHERE id = ${id} AND deletion_token_hash = ${deletionHash}
        RETURNING id
      `;
      await transaction`
        INSERT INTO area_pulse_audit_log (id, expires_at, action, actor_key, target_id, outcome, metadata)
        VALUES (${crypto.randomUUID()}, now() + interval '30 days', 'report.delete', ${actorKey}, ${id}, ${removed.length ? "deleted" : "not-found"}, '{}'::jsonb)
      `;
      return removed.length > 0;
    });
  } catch {
    throw new AreaPulseStorageError("Area Pulse storage is unavailable.");
  }
}

export async function loadAreaPulseRegion(region: CoarseRegion): Promise<{ reports: StoredAreaReport[]; history: HistoricalBucket[]; officialMessages: OfficialProviderMessage[] }> {
  try {
    const sql = database();
    const reports = await sql<ReportRow[]>`
      SELECT id, created_at, expires_at, report_kind, provider_key, isp_display, asn,
             region_key, region_label, region_level, country_code, service_name,
             reporter_key, measurement
      FROM area_pulse_reports
      WHERE region_key = ${region.key} AND hidden = false
        AND created_at > now() - interval '30 minutes' AND expires_at > now()
      ORDER BY created_at DESC LIMIT 2000
    `;
    const history = await sql<HistoryRow[]>`
      SELECT provider_key, report_kind, service_name, date_trunc('hour', created_at) AS bucket,
             count(DISTINCT reporter_key)::int AS count
      FROM area_pulse_reports
      WHERE region_key = ${region.key} AND hidden = false
        AND created_at > now() - interval '28 days' AND created_at < now() - interval '24 hours'
      GROUP BY provider_key, report_kind, service_name, bucket
      ORDER BY bucket DESC LIMIT 10000
    `;
    const messages = await sql<MessageRow[]>`
      SELECT id, isp_display, asn, region_key, region_label, region_level, country_code,
             title, message, status, published_at, expires_at, source_url, source_label
      FROM area_pulse_provider_messages
      WHERE official = true AND expires_at > now() AND (region_key IS NULL OR region_key = ${region.key})
      ORDER BY published_at DESC LIMIT 100
    `;
    return { reports: reports.map(reportFromRow), history: history.map(historyFromRow), officialMessages: messages.map(messageFromRow) };
  } catch {
    throw new AreaPulseStorageError("Area Pulse storage is unavailable.");
  }
}

export async function upsertProviderMessage(message: ValidProviderMessage, actorKey: string): Promise<void> {
  const sql = database();
  const key = providerKey(message.isp, message.asn);
  try {
    await sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO area_pulse_provider_messages (
          id, provider_key, isp_display, asn, region_key, region_label, region_level,
          country_code, title, message, status, published_at, expires_at, source_url, source_label, official
        ) VALUES (
          ${message.id}, ${key}, ${message.isp}, ${message.asn}, ${message.regionKey}, ${message.regionLabel}, ${message.regionLevel},
          ${message.countryCode}, ${message.title}, ${message.message}, ${message.status}, ${message.publishedAt}, ${message.expiresAt}, ${message.sourceUrl}, ${message.sourceLabel}, true
        )
        ON CONFLICT (id) DO UPDATE SET
          title = excluded.title, message = excluded.message, status = excluded.status,
          published_at = excluded.published_at, observed_at = now(), expires_at = excluded.expires_at,
          source_url = excluded.source_url, source_label = excluded.source_label
      `;
      await transaction`
        INSERT INTO area_pulse_audit_log (id, expires_at, action, actor_key, target_id, outcome, metadata)
        VALUES (${crypto.randomUUID()}, now() + interval '30 days', 'provider-message.upsert', ${actorKey}, ${message.id}, 'accepted', ${JSON.stringify({ providerKey: key, regional: Boolean(message.regionKey) })})
      `;
    });
  } catch {
    throw new AreaPulseStorageError("Area Pulse storage is unavailable.");
  }
}

export async function claimAdminNonce(nonce: string, actorKey: string): Promise<boolean> {
  try {
    const rows = await database()<{ nonce: string }[]>`
      INSERT INTO area_pulse_admin_nonces (nonce, actor_key, expires_at)
      VALUES (${nonce}, ${actorKey}, now() + interval '10 minutes')
      ON CONFLICT (nonce) DO NOTHING
      RETURNING nonce
    `;
    return rows.length === 1;
  } catch {
    throw new AreaPulseStorageError("Area Pulse storage is unavailable.");
  }
}

export async function createAbuseReport(report: ValidAbuseReport, actorKey: string, duplicateKey: string): Promise<void> {
  const sql = database();
  try {
    await sql.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(hashtextextended(${actorKey}, 0))`;
      const daily = await transaction<{ count: number }[]>`
        SELECT count(*)::int AS count FROM area_pulse_abuse_reports
        WHERE actor_key = ${actorKey} AND created_at > now() - interval '24 hours'
      `;
      if ((daily[0]?.count ?? 0) >= 3) throw new AreaPulseAbuseLimitError("Abuse-report limit reached. Try again later.");
      const duplicate = await transaction<{ exists: boolean }[]>`
        SELECT EXISTS(
          SELECT 1 FROM area_pulse_abuse_reports
          WHERE duplicate_key = ${duplicateKey} AND created_at > now() - interval '24 hours'
        ) AS exists
      `;
      if (duplicate[0]?.exists) throw new AreaPulseDuplicateError("A matching abuse report was already received recently.");
      await transaction`
        INSERT INTO area_pulse_abuse_reports (id, expires_at, incident_id, reason, details, actor_key, duplicate_key)
        VALUES (${crypto.randomUUID()}, now() + interval '30 days', ${report.incidentId}, ${report.reason}, ${report.details}, ${actorKey}, ${duplicateKey})
      `;
      await transaction`
        INSERT INTO area_pulse_audit_log (id, expires_at, action, actor_key, target_id, outcome, metadata)
        VALUES (${crypto.randomUUID()}, now() + interval '30 days', 'incident.abuse-report', ${actorKey}, ${report.incidentId}, 'accepted', ${JSON.stringify({ reason: report.reason })})
      `;
    });
  } catch (error) {
    if (error instanceof AreaPulseAbuseLimitError || error instanceof AreaPulseDuplicateError) throw error;
    throw new AreaPulseStorageError("Area Pulse abuse reporting is unavailable.");
  }
}

export async function cleanupAreaPulse(): Promise<{ reports: number; messages: number; audits: number; abuseReports: number }> {
  try {
    const sql = database();
    return await sql.begin(async (transaction) => {
      const reports = await transaction<{ id: string }[]>`DELETE FROM area_pulse_reports WHERE created_at < now() - (${REPORT_RETENTION_DAYS} * interval '1 day') RETURNING id`;
      const messages = await transaction<{ id: string }[]>`DELETE FROM area_pulse_provider_messages WHERE expires_at < now() - interval '7 days' RETURNING id`;
      const audits = await transaction<{ id: string }[]>`DELETE FROM area_pulse_audit_log WHERE expires_at < now() RETURNING id`;
      const abuseReports = await transaction<{ id: string }[]>`DELETE FROM area_pulse_abuse_reports WHERE expires_at < now() RETURNING id`;
      await transaction`DELETE FROM area_pulse_admin_nonces WHERE expires_at < now()`;
      return { reports: reports.length, messages: messages.length, audits: audits.length, abuseReports: abuseReports.length };
    });
  } catch {
    throw new AreaPulseStorageError("Area Pulse storage is unavailable.");
  }
}

function database(): ReturnType<typeof postgres> {
  if (client) return client;
  const url = databaseUrl();
  if (!url) throw new AreaPulseStorageError("Area Pulse database is not configured.");
  client = postgres(url, { max: 1, idle_timeout: 20, connect_timeout: 5, prepare: false, ssl: "require" });
  return client;
}

function databaseUrl(): string | null {
  return process.env.POSTGRES_URL?.trim() || process.env.DATABASE_URL?.trim() || null;
}

type ReportRow = {
  id: string; created_at: Date; expires_at: Date; report_kind: StoredAreaReport["kind"];
  provider_key: string; isp_display: string; asn: string | null; region_key: string;
  region_label: string; region_level: CoarseRegion["level"]; country_code: string;
  service_name: string | null; reporter_key: string; measurement: unknown;
};

type HistoryRow = { provider_key: string; report_kind: StoredAreaReport["kind"]; service_name: string | null; bucket: Date; count: number };
type MessageRow = { id: string; isp_display: string; asn: string | null; region_key: string | null; region_label: string | null; region_level: CoarseRegion["level"] | null; country_code: string | null; title: string; message: string; status: OfficialProviderMessage["status"]; published_at: Date; expires_at: Date; source_url: string; source_label: string };

function reportFromRow(row: ReportRow): StoredAreaReport {
  return { id: row.id, createdAt: new Date(row.created_at), expiresAt: new Date(row.expires_at), kind: row.report_kind, providerKey: row.provider_key, isp: row.isp_display, asn: row.asn, region: { key: row.region_key, label: row.region_label, level: row.region_level, countryCode: row.country_code, approximate: true }, service: row.service_name, reporterKey: row.reporter_key, measurement: parseMeasurement(row.measurement) };
}

function historyFromRow(row: HistoryRow): HistoricalBucket {
  return { providerKey: row.provider_key, kind: row.report_kind, service: row.service_name, count: row.count };
}

function messageFromRow(row: MessageRow): OfficialProviderMessage {
  const region = row.region_key && row.region_label && row.region_level && row.country_code ? { key: row.region_key, label: row.region_label, level: row.region_level, countryCode: row.country_code, approximate: true as const } : null;
  return { id: row.id, isp: row.isp_display, asn: row.asn, region, title: row.title, message: row.message, status: row.status, publishedAt: new Date(row.published_at).toISOString(), expiresAt: new Date(row.expires_at).toISOString(), sourceUrl: row.source_url, sourceLabel: row.source_label, official: true };
}

function parseMeasurement(value: unknown): StoredAreaReport["measurement"] {
  if (!isRecord(value)) return null;
  const record = value;
  return { dnsFailed: typeof record.dnsFailed === "boolean" ? record.dnsFailed : null, primaryReachable: typeof record.primaryReachable === "boolean" ? record.primaryReachable : null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
