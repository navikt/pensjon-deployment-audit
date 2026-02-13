-- Add classification fields to deployment deviations
ALTER TABLE deployment_deviations
  ADD COLUMN breach_type TEXT,
  ADD COLUMN intent TEXT CHECK (intent IN ('malicious', 'accidental', 'unknown')),
  ADD COLUMN severity TEXT CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  ADD COLUMN follow_up_role TEXT CHECK (follow_up_role IN ('product_lead', 'delivery_lead', 'section_lead'));
