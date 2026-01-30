-- Initial database schema
-- This is the base schema extracted from schema.sql

-- Monitored applications (primary entity)
CREATE TABLE IF NOT EXISTS monitored_applications (
  id SERIAL PRIMARY KEY,
  team_slug VARCHAR(255) NOT NULL,
  environment_name VARCHAR(255) NOT NULL,
  app_name VARCHAR(255) NOT NULL,
  
  -- Metadata
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(team_slug, environment_name, app_name)
);

CREATE INDEX IF NOT EXISTS idx_monitored_apps_team ON monitored_applications(team_slug);
CREATE INDEX IF NOT EXISTS idx_monitored_apps_active ON monitored_applications(is_active);

-- Application repositories (many-to-one with monitored_applications)
CREATE TABLE IF NOT EXISTS application_repositories (
  id SERIAL PRIMARY KEY,
  monitored_app_id INTEGER REFERENCES monitored_applications(id) ON DELETE CASCADE,
  
  -- Repository identity
  github_owner VARCHAR(255) NOT NULL DEFAULT 'navikt',
  github_repo_name VARCHAR(255) NOT NULL,
  
  -- Status: 'active', 'historical', 'pending_approval'
  status VARCHAR(50) NOT NULL DEFAULT 'pending_approval',
  
  -- Repository redirect (for renamed repos)
  redirects_to_owner VARCHAR(255),
  redirects_to_repo VARCHAR(255),
  
  -- Metadata
  notes TEXT,
  approved_at TIMESTAMP WITH TIME ZONE,
  approved_by VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(monitored_app_id, github_owner, github_repo_name)
);

CREATE INDEX IF NOT EXISTS idx_app_repos_app ON application_repositories(monitored_app_id);
CREATE INDEX IF NOT EXISTS idx_app_repos_status ON application_repositories(status);

-- Deployments table
CREATE TABLE IF NOT EXISTS deployments (
  id SERIAL PRIMARY KEY,
  monitored_app_id INTEGER REFERENCES monitored_applications(id) ON DELETE CASCADE,
  
  -- Nais deployment data
  nais_deployment_id VARCHAR(255) UNIQUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL,
  team_slug VARCHAR(255) NOT NULL,
  environment_name VARCHAR(255) NOT NULL,
  app_name VARCHAR(255) NOT NULL,
  deployer_username VARCHAR(255),
  commit_sha VARCHAR(255),
  trigger_url TEXT,
  
  -- Detected repository info (from Nais data)
  detected_github_owner VARCHAR(255),
  detected_github_repo_name VARCHAR(255),
  
  -- Four-eyes verification
  has_four_eyes BOOLEAN DEFAULT FALSE,
  four_eyes_status VARCHAR(50) DEFAULT 'unknown',
  -- Possible values: 'approved_pr', 'approved_pr_with_unreviewed', 'pr_not_approved', 'direct_push', 'error', 'legacy', 'pending', 'unknown'
  
  github_pr_number INTEGER,
  github_pr_url TEXT,
  
  -- PR metadata (JSONB for flexibility)
  github_pr_data JSONB,
  -- Structure: {
  --   title: string,
  --   body: string,
  --   labels: string[],
  --   created_at: string,
  --   merged_at: string,
  --   base_branch: string,
  --   base_sha: string,
  --   commits_count: number,
  --   changed_files: number,
  --   additions: number,
  --   deletions: number,
  --   draft: boolean,
  --   creator: { username: string, avatar_url: string },
  --   merger: { username: string, avatar_url: string },
  --   reviewers: [{ username: string, avatar_url: string, state: string, submitted_at: string }],
  --   checks_passed: boolean,
  --   checks: [{ name: string, status: string, conclusion: string, started_at: string, completed_at: string, html_url: string }],
  --   commits: [{ sha: string, message: string, author: { username: string, avatar_url: string }, committer: { username: string, avatar_url: string }, html_url: string }],
  --   unreviewed_commits?: [{ sha: string, message: string, author: string, date: string, html_url: string, reason: string }]
  -- }
  
  -- Branch and merge information
  branch_name VARCHAR(255),
  parent_commits JSONB, -- Array of {sha: string}
  
  synced_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_deployments_app ON deployments(monitored_app_id);
CREATE INDEX IF NOT EXISTS idx_deployments_nais_id ON deployments(nais_deployment_id);
CREATE INDEX IF NOT EXISTS idx_deployments_created_at ON deployments(created_at);
CREATE INDEX IF NOT EXISTS idx_deployments_commit_sha ON deployments(commit_sha);
CREATE INDEX IF NOT EXISTS idx_deployments_four_eyes ON deployments(has_four_eyes);
CREATE INDEX IF NOT EXISTS idx_deployments_four_eyes_status ON deployments(four_eyes_status);
CREATE INDEX IF NOT EXISTS idx_deployments_detected_repo ON deployments(detected_github_owner, detected_github_repo_name);

-- Repository mismatch alerts
CREATE TABLE IF NOT EXISTS repository_alerts (
  id SERIAL PRIMARY KEY,
  monitored_app_id INTEGER REFERENCES monitored_applications(id) ON DELETE CASCADE,
  deployment_id INTEGER REFERENCES deployments(id) ON DELETE CASCADE,
  
  alert_type VARCHAR(50) NOT NULL DEFAULT 'repository_changed',
  -- Alert types: 'repository_changed', 'new_repository_detected'
  
  -- Alert details
  old_owner VARCHAR(255),
  old_repo VARCHAR(255),
  new_owner VARCHAR(255) NOT NULL,
  new_repo VARCHAR(255) NOT NULL,
  
  -- Status
  status VARCHAR(50) NOT NULL DEFAULT 'open',
  -- Status values: 'open', 'acknowledged', 'resolved', 'approved'
  
  -- Resolution
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolved_by VARCHAR(255),
  resolution_notes TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_alerts_app ON repository_alerts(monitored_app_id);
CREATE INDEX IF NOT EXISTS idx_alerts_deployment ON repository_alerts(deployment_id);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON repository_alerts(status);

-- Comments and manual verifications
CREATE TABLE IF NOT EXISTS deployment_comments (
  id SERIAL PRIMARY KEY,
  deployment_id INTEGER REFERENCES deployments(id) ON DELETE CASCADE,
  
  comment_text TEXT NOT NULL,
  slack_link TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_comments_deployment ON deployment_comments(deployment_id);

-- Tertial goals tracking
CREATE TABLE IF NOT EXISTS tertial_boards (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tertial_goals (
  id SERIAL PRIMARY KEY,
  board_id INTEGER REFERENCES tertial_boards(id) ON DELETE CASCADE,
  monitored_app_id INTEGER REFERENCES monitored_applications(id) ON DELETE CASCADE,
  
  goal_percentage INTEGER NOT NULL CHECK (goal_percentage >= 0 AND goal_percentage <= 100),
  notes TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(board_id, monitored_app_id)
);

CREATE INDEX IF NOT EXISTS idx_goals_board ON tertial_goals(board_id);
CREATE INDEX IF NOT EXISTS idx_goals_app ON tertial_goals(monitored_app_id);
