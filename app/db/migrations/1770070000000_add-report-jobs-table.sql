-- Report generation jobs for async PDF generation
CREATE TABLE report_jobs (
  id SERIAL PRIMARY KEY,
  job_id UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  monitored_app_id INTEGER REFERENCES monitored_applications(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, processing, completed, failed
  pdf_data BYTEA,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Index for looking up jobs by job_id
CREATE INDEX idx_report_jobs_job_id ON report_jobs(job_id);

-- Index for cleanup of old jobs
CREATE INDEX idx_report_jobs_created_at ON report_jobs(created_at);
