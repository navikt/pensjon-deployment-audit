-- Add deployment notification settings per app
ALTER TABLE monitored_applications
ADD COLUMN IF NOT EXISTS slack_deploy_channel_id TEXT,
ADD COLUMN IF NOT EXISTS slack_deploy_notify_enabled BOOLEAN DEFAULT false;

-- Track whether deployment notification has been sent
ALTER TABLE deployments
ADD COLUMN IF NOT EXISTS slack_deploy_message_ts TEXT;

-- Index for efficiently finding deployments needing notification
CREATE INDEX IF NOT EXISTS idx_deployments_slack_deploy_pending
ON deployments (created_at DESC)
WHERE slack_deploy_message_ts IS NULL;
