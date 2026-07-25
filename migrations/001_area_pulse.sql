BEGIN;

CREATE TABLE IF NOT EXISTS area_pulse_reports (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_observed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  report_kind text NOT NULL CHECK (report_kind IN ('complete_outage','intermittent','slow_speed','high_latency','dns_problem','service_unavailable')),
  provider_key text NOT NULL,
  isp_display text NOT NULL,
  asn text,
  region_key text NOT NULL,
  region_label text NOT NULL,
  region_level text NOT NULL CHECK (region_level IN ('city','subdivision','country')),
  country_code text NOT NULL,
  service_name text,
  note text,
  reporter_key text NOT NULL,
  duplicate_key text NOT NULL,
  deletion_token_hash text NOT NULL,
  measurement jsonb,
  identity_provenance text NOT NULL CHECK (identity_provenance IN ('user-consented','unavailable')),
  hidden boolean NOT NULL DEFAULT false,
  abuse_score smallint NOT NULL DEFAULT 0 CHECK (abuse_score BETWEEN 0 AND 100)
);

CREATE INDEX IF NOT EXISTS area_pulse_reports_active_region_idx ON area_pulse_reports (region_key, expires_at DESC) WHERE hidden = false;
CREATE INDEX IF NOT EXISTS area_pulse_reports_provider_window_idx ON area_pulse_reports (provider_key, region_key, report_kind, created_at DESC) WHERE hidden = false;
CREATE INDEX IF NOT EXISTS area_pulse_reports_reporter_rate_idx ON area_pulse_reports (reporter_key, created_at DESC);
CREATE INDEX IF NOT EXISTS area_pulse_reports_duplicate_idx ON area_pulse_reports (duplicate_key, created_at DESC);

CREATE TABLE IF NOT EXISTS area_pulse_provider_messages (
  id text PRIMARY KEY,
  provider_key text NOT NULL,
  isp_display text NOT NULL,
  asn text,
  region_key text,
  region_label text,
  region_level text CHECK (region_level IS NULL OR region_level IN ('city','subdivision','country')),
  country_code text,
  title text NOT NULL,
  message text NOT NULL,
  status text NOT NULL CHECK (status IN ('active','monitoring','resolved')),
  published_at timestamptz NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  source_url text NOT NULL,
  source_label text NOT NULL,
  official boolean NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS area_pulse_provider_messages_active_idx ON area_pulse_provider_messages (provider_key, expires_at DESC) WHERE official = true;

CREATE TABLE IF NOT EXISTS area_pulse_audit_log (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  action text NOT NULL,
  actor_key text NOT NULL,
  target_id text,
  outcome text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS area_pulse_audit_expiry_idx ON area_pulse_audit_log (expires_at);

CREATE TABLE IF NOT EXISTS area_pulse_admin_nonces (
  nonce text PRIMARY KEY,
  actor_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS area_pulse_admin_nonces_expiry_idx ON area_pulse_admin_nonces (expires_at);

CREATE TABLE IF NOT EXISTS area_pulse_abuse_reports (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  incident_id text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('inaccurate','personal_data','spam','other')),
  details text,
  actor_key text NOT NULL,
  duplicate_key text NOT NULL
);

CREATE INDEX IF NOT EXISTS area_pulse_abuse_actor_rate_idx ON area_pulse_abuse_reports (actor_key, created_at DESC);
CREATE INDEX IF NOT EXISTS area_pulse_abuse_duplicate_idx ON area_pulse_abuse_reports (duplicate_key, created_at DESC);
CREATE INDEX IF NOT EXISTS area_pulse_abuse_expiry_idx ON area_pulse_abuse_reports (expires_at);

REVOKE ALL ON area_pulse_reports, area_pulse_provider_messages, area_pulse_audit_log, area_pulse_admin_nonces, area_pulse_abuse_reports FROM PUBLIC;

COMMIT;
