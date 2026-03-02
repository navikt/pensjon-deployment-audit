-- Migration: Direct link between dev teams and monitored applications.
-- Allows explicit governance by linking specific apps to dev teams,
-- independent of the nais team mapping.

CREATE TABLE IF NOT EXISTS dev_team_applications (
  dev_team_id INTEGER NOT NULL REFERENCES dev_teams(id) ON DELETE CASCADE,
  monitored_app_id INTEGER NOT NULL REFERENCES monitored_applications(id) ON DELETE CASCADE,
  PRIMARY KEY (dev_team_id, monitored_app_id)
);

CREATE INDEX IF NOT EXISTS idx_dev_team_applications_app ON dev_team_applications(monitored_app_id);
