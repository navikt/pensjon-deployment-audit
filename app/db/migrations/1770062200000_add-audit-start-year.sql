-- Add audit_start_year column to monitored_applications
-- Deployments before this year are ignored in audit reports and statistics

ALTER TABLE monitored_applications 
ADD COLUMN IF NOT EXISTS audit_start_year INTEGER DEFAULT 2025;

-- Convert existing 'baseline' deployments to 'pending_baseline'
-- They need manual approval to be considered baseline
UPDATE deployments 
SET four_eyes_status = 'pending_baseline'
WHERE four_eyes_status = 'baseline';
