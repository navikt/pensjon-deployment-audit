-- Add default_branch column to monitored_applications
-- Used to filter PR lookups to only include PRs targeting this branch

ALTER TABLE monitored_applications
ADD COLUMN IF NOT EXISTS default_branch VARCHAR(255) DEFAULT 'main';

COMMENT ON COLUMN monitored_applications.default_branch IS 'The default branch to verify PRs against (e.g., main, master)';
