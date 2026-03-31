CREATE TABLE IF NOT EXISTS cron_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  cron_pattern    TEXT NOT NULL,
  started_at      TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at     TEXT,
  items_processed INTEGER DEFAULT 0,
  items_failed    INTEGER DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  error           TEXT,
  meta            TEXT
);

CREATE INDEX idx_cron_log_pattern ON cron_log(cron_pattern, started_at DESC);

ALTER TABLE localities ADD COLUMN geocode_retry_after TEXT;
ALTER TABLE localities ADD COLUMN geocode_fail_count INTEGER NOT NULL DEFAULT 0;
