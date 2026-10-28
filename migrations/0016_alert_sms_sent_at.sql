-- Actual last opening-notice send time (KST), separate from status edit time.
-- Unknown historical send times remain NULL; verified sends are backfilled
-- separately from scoped message evidence, never from status_updated_at.
ALTER TABLE submissions ADD COLUMN last_sms_sent_at TEXT;
