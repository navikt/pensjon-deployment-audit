-- Migration: Add user mapping table for GitHub to Nav identity
-- Maps GitHub usernames to Nav email, name and Slack member ID

CREATE TABLE user_mappings (
  github_username TEXT PRIMARY KEY,
  display_name TEXT,
  nav_email TEXT,
  nav_ident TEXT,
  slack_member_id TEXT,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for Slack lookups
CREATE INDEX idx_user_mappings_slack ON user_mappings(slack_member_id);

-- Index for email lookups
CREATE INDEX idx_user_mappings_email ON user_mappings(nav_email);

COMMENT ON TABLE user_mappings IS 'Maps GitHub usernames to Nav identity and Slack';
COMMENT ON COLUMN user_mappings.display_name IS 'Full name (e.g. Per Christian Moen)';
COMMENT ON COLUMN user_mappings.nav_email IS 'Nav email address (e.g. per.christian.moen@nav.no)';
COMMENT ON COLUMN user_mappings.nav_ident IS 'Nav ident (e.g. P123456)';
COMMENT ON COLUMN user_mappings.slack_member_id IS 'Slack member ID (e.g. U01ABC123)';
