-- Run only as a database owner after reviewing role names with the operator.
-- This script creates no login or password. Grant the group role to a separate,
-- rotated application login managed by the database provider.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'netpulse_area_app') THEN
    CREATE ROLE netpulse_area_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT;
  END IF;
END
$$;

REVOKE ALL ON area_pulse_reports, area_pulse_provider_messages, area_pulse_audit_log, area_pulse_admin_nonces, area_pulse_abuse_reports FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO netpulse_area_app;
GRANT SELECT, INSERT, DELETE ON area_pulse_reports TO netpulse_area_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON area_pulse_provider_messages TO netpulse_area_app;
GRANT INSERT, DELETE ON area_pulse_audit_log TO netpulse_area_app;
GRANT INSERT, DELETE ON area_pulse_admin_nonces TO netpulse_area_app;
GRANT SELECT, INSERT, DELETE ON area_pulse_abuse_reports TO netpulse_area_app;

ALTER TABLE area_pulse_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE area_pulse_provider_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE area_pulse_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE area_pulse_admin_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE area_pulse_abuse_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS netpulse_area_app_reports ON area_pulse_reports;
CREATE POLICY netpulse_area_app_reports ON area_pulse_reports FOR ALL TO netpulse_area_app USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS netpulse_area_app_messages ON area_pulse_provider_messages;
CREATE POLICY netpulse_area_app_messages ON area_pulse_provider_messages FOR ALL TO netpulse_area_app USING (true) WITH CHECK (official = true);
DROP POLICY IF EXISTS netpulse_area_app_audit ON area_pulse_audit_log;
CREATE POLICY netpulse_area_app_audit ON area_pulse_audit_log FOR ALL TO netpulse_area_app USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS netpulse_area_app_nonces ON area_pulse_admin_nonces;
CREATE POLICY netpulse_area_app_nonces ON area_pulse_admin_nonces FOR ALL TO netpulse_area_app USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS netpulse_area_app_abuse ON area_pulse_abuse_reports;
CREATE POLICY netpulse_area_app_abuse ON area_pulse_abuse_reports FOR ALL TO netpulse_area_app USING (true) WITH CHECK (true);
