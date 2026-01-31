-- Migration: Add title column to deployments
-- This column stores either the PR title or the first line of the commit message
-- for faster queries on large datasets

ALTER TABLE deployments ADD COLUMN IF NOT EXISTS title VARCHAR(500);

-- Backfill from github_pr_data for existing PR deployments
UPDATE deployments 
SET title = github_pr_data->>'title'
WHERE github_pr_data IS NOT NULL 
  AND github_pr_data->>'title' IS NOT NULL
  AND title IS NULL;

-- Create index for searching by title
CREATE INDEX IF NOT EXISTS idx_deployments_title ON deployments (title);

COMMENT ON COLUMN deployments.title IS 'PR title or first line of commit message for display purposes';
