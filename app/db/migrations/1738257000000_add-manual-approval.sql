-- Migration: Add manual approval support to deployment_comments
-- This allows tracking manual approvals for deployments with unreviewed commits

ALTER TABLE deployment_comments 
ADD COLUMN IF NOT EXISTS comment_type VARCHAR(20) NOT NULL DEFAULT 'comment';
-- Types: 'comment', 'slack_link', 'manual_approval'

ALTER TABLE deployment_comments
ADD COLUMN IF NOT EXISTS approved_by VARCHAR(255);

ALTER TABLE deployment_comments
ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP;

-- Add index for querying manual approvals
CREATE INDEX IF NOT EXISTS idx_deployment_comments_type ON deployment_comments(comment_type);

-- Update existing comments to have explicit type (only if they don't have one)
UPDATE deployment_comments
SET comment_type = CASE
  WHEN slack_link IS NOT NULL THEN 'slack_link'
  ELSE 'comment'
END
WHERE comment_type IS NULL OR comment_type = 'comment';
