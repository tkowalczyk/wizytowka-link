-- Expand call_log.status CHECK from 4 to 7 values.
-- D1/SQLite cannot ALTER CHECK constraints, so: create new table → copy → drop → rename.

CREATE TABLE call_log_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  seller_id   INTEGER NOT NULL REFERENCES sellers(id),
  status      TEXT    NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'called', 'interested', 'rejected', 'no_answer', 'meeting_set', 'deal_closed')),
  comment     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO call_log_new (id, business_id, seller_id, status, comment, created_at)
  SELECT id, business_id, seller_id, status, comment, created_at FROM call_log;

DROP TABLE call_log;

ALTER TABLE call_log_new RENAME TO call_log;

CREATE INDEX idx_call_log_business ON call_log(business_id);
CREATE INDEX idx_call_log_seller_biz ON call_log(seller_id, business_id);
