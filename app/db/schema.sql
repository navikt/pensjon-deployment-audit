-- Database schema for Pensjon Deployment Audit Application
-- Application-centric model with repository validation

-- Monitored applications (primary entity)
CREATE TABLE IF NOT EXISTS monitored_applications (
  id SERIAL PRIMARY KEY,
  team_slug VARCHAR(255) NOT NULL,
  environment_name VARCHAR(255) NOT NULL,
  app_name VARCHAR(255) NOT NULL,
  
  -- Approved/expected repository
  approved_github_owner VARCHAR(255) NOT NULL DEFAULT 'navikt',
  approved_github_repo_name VARCHAR(255) NOT NULL,
  
  -- Metadata
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(team_slug, environment_name, app_name)
);

CREATE INDEX IF NOT EXISTS idx_monitored_apps_team ON monitored_applications(team_slug);
CREATE INDEX IF NOT EXISTS idx_monitored_apps_active ON monitored_applications(is_active);

-- Deployments from Nais
CREATE TABLE IF NOT EXISTS deployments (
  id SERIAL PRIMARY KEY,
  monitored_app_id INTEGER REFERENCES monitored_applications(id) ON DELETE CASCADE,
  
  -- Nais deployment data
  nais_deployment_id VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL,
  deployer_username VARCHAR(255), -- Nullable: not always provided by Nais API
  commit_sha VARCHAR(40), -- Nullable: not always provided by Nais API
  trigger_url TEXT,
  
  -- Detected repository (may differ from approved!)
  detected_github_owner VARCHAR(255) NOT NULL,
  detected_github_repo_name VARCHAR(255) NOT NULL,
  
  -- Four-eyes status
  has_four_eyes BOOLEAN DEFAULT FALSE,
  four_eyes_status VARCHAR(50) DEFAULT 'unknown',
  -- Possible values: 'approved_pr', 'pr_not_approved', 'direct_push', 'error', 'repository_mismatch', 'unknown'
  
  github_pr_number INTEGER,
  github_pr_url TEXT,
  
  -- Kubernetes resources (JSONB for flexibility)
  resources JSONB,
  
  synced_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_deployments_monitored_app ON deployments(monitored_app_id);
CREATE INDEX IF NOT EXISTS idx_deployments_created_at ON deployments(created_at);
CREATE INDEX IF NOT EXISTS idx_deployments_commit_sha ON deployments(commit_sha);
CREATE INDEX IF NOT EXISTS idx_deployments_four_eyes_status ON deployments(four_eyes_status);
CREATE INDEX IF NOT EXISTS idx_deployments_detected_repo ON deployments(detected_github_owner, detected_github_repo_name);

-- Repository mismatch alerts
CREATE TABLE IF NOT EXISTS repository_alerts (
  id SERIAL PRIMARY KEY,
  monitored_app_id INTEGER REFERENCES monitored_applications(id) ON DELETE CASCADE,
  deployment_id INTEGER REFERENCES deployments(id) ON DELETE CASCADE,
  
  alert_type VARCHAR(50) NOT NULL DEFAULT 'repository_changed',
  -- Future: could have other alert types like 'unauthorized_deployer', 'suspicious_timing', etc.
  
  expected_github_owner VARCHAR(255) NOT NULL,
  expected_github_repo_name VARCHAR(255) NOT NULL,
  detected_github_owner VARCHAR(255) NOT NULL,
  detected_github_repo_name VARCHAR(255) NOT NULL,
  
  -- Resolution tracking
  resolved BOOLEAN DEFAULT FALSE,
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolved_by VARCHAR(255),
  resolution_note TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_alerts_monitored_app ON repository_alerts(monitored_app_id);
CREATE INDEX IF NOT EXISTS idx_alerts_resolved ON repository_alerts(resolved);
CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON repository_alerts(created_at);

-- Comments on deployments (including Slack links for direct pushes)
CREATE TABLE IF NOT EXISTS deployment_comments (
  id SERIAL PRIMARY KEY,
  deployment_id INTEGER REFERENCES deployments(id) ON DELETE CASCADE,
  comment_text TEXT NOT NULL,
  slack_link TEXT,
  created_by VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_deployment_comments_deployment_id ON deployment_comments(deployment_id);

-- Tertial boards for teams
CREATE TABLE IF NOT EXISTS tertial_boards (
  id SERIAL PRIMARY KEY,
  team_name VARCHAR(255) NOT NULL,
  year INTEGER NOT NULL,
  tertial INTEGER NOT NULL CHECK (tertial IN (1, 2, 3)),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(team_name, year, tertial)
);

-- Goals within tertial boards
CREATE TABLE IF NOT EXISTS tertial_goals (
  id SERIAL PRIMARY KEY,
  board_id INTEGER REFERENCES tertial_boards(id) ON DELETE CASCADE,
  goal_title VARCHAR(512) NOT NULL,
  goal_description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tertial_goals_board_id ON tertial_goals(board_id);

-- Many-to-many relationship between deployments and goals
CREATE TABLE IF NOT EXISTS deployment_goals (
  deployment_id INTEGER REFERENCES deployments(id) ON DELETE CASCADE,
  goal_id INTEGER REFERENCES tertial_goals(id) ON DELETE CASCADE,
  PRIMARY KEY (deployment_id, goal_id)
);

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_monitored_apps_updated_at BEFORE UPDATE ON monitored_applications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
