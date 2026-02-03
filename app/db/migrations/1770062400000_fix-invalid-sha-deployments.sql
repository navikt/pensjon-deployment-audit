-- Fix deployments with invalid commit SHA (refs/ prefix instead of actual SHA)
-- These were incorrectly processed by sync and need to be reset to legacy status

-- Reset deployments where commit_sha starts with 'refs/' to legacy status
-- This allows them to be manually looked up using the legacy flow
UPDATE deployments 
SET four_eyes_status = 'legacy',
    has_four_eyes = false,
    github_pr_number = NULL,
    github_pr_url = NULL,
    github_pr_data = NULL
WHERE commit_sha LIKE 'refs/%';
