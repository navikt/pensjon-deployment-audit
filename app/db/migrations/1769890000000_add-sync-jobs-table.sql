-- Sync jobs table for distributed locking and job tracking
CREATE TABLE sync_jobs (
  id SERIAL PRIMARY KEY,
  job_type TEXT NOT NULL,           -- 'nais_sync' | 'github_verify'
  monitored_app_id INTEGER REFERENCES monitored_applications(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'running' | 'completed' | 'failed'
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  locked_by TEXT,                   -- Pod/instance identifier
  lock_expires_at TIMESTAMPTZ,      -- Auto-release after timeout
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unique constraint: only one running job per app per type
CREATE UNIQUE INDEX sync_jobs_active_lock 
  ON sync_jobs (job_type, monitored_app_id) 
  WHERE status = 'running';

-- Index for finding expired locks
CREATE INDEX sync_jobs_expired_locks ON sync_jobs (lock_expires_at) WHERE status = 'running';

-- Index for job history queries
CREATE INDEX sync_jobs_app_history ON sync_jobs (monitored_app_id, created_at DESC);
