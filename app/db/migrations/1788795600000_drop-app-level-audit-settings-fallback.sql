-- Remove the per-application fallback storage for audit_start_year and
-- implicit_approval. Repository-level settings (repositories table) are now
-- the only source of truth for these two settings; applications without a
-- linked repository have no code to audit or approve, so the setting is
-- simply unavailable (NULL / 'off') rather than falling back to a per-app
-- value. default_branch fallback on monitored_applications is unaffected.

ALTER TABLE monitored_applications
  DROP COLUMN IF EXISTS audit_start_year;

DELETE FROM app_settings WHERE setting_key = 'implicit_approval';
