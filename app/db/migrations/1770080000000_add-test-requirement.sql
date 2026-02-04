-- Add test requirement configuration to monitored applications
-- Options: 'none', 'unit_tests', 'integration_tests'
ALTER TABLE monitored_applications 
ADD COLUMN test_requirement TEXT NOT NULL DEFAULT 'none';

-- Add comment explaining the column
COMMENT ON COLUMN monitored_applications.test_requirement IS 
'Required test level before deployment: none, unit_tests, integration_tests';
