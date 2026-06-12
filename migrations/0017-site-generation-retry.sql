ALTER TABLE businesses ADD COLUMN site_retry_after TEXT;
ALTER TABLE businesses ADD COLUMN site_fail_count INTEGER NOT NULL DEFAULT 0;
