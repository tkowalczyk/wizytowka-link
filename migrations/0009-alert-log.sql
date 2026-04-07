CREATE TABLE IF NOT EXISTS alert_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  kind    TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_alert_log_kind_sent ON alert_log(kind, sent_at DESC);
