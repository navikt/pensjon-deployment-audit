-- Add reminder configuration to monitored_applications
ALTER TABLE monitored_applications
ADD COLUMN IF NOT EXISTS reminder_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS reminder_time TEXT DEFAULT '09:00',
ADD COLUMN IF NOT EXISTS reminder_days TEXT[] DEFAULT ARRAY['mon', 'tue', 'wed', 'thu', 'fri'],
ADD COLUMN IF NOT EXISTS reminder_last_sent_at TIMESTAMPTZ;
