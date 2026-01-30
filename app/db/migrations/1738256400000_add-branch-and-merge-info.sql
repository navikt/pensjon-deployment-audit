-- Migration: Add branch and merge commit information to deployments
-- This allows us to track which branch was deployed and parent commits for merge commits

ALTER TABLE deployments 
  ADD COLUMN IF NOT EXISTS branch_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS parent_commits JSONB;

-- Structure for parent_commits JSONB:
-- For merge commits: [{ sha: string, branch: string }, ...]
-- For regular commits: null or []

COMMENT ON COLUMN deployments.branch_name IS 'Branch that was deployed (from GitHub Actions workflow)';
COMMENT ON COLUMN deployments.parent_commits IS 'Parent commit SHAs for merge commits';
