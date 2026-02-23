-- Split single Telegram bot into 3 separate bots:
-- 1. Client bot (owner edits)
-- 2. Notify bot (form fill alerts → sellers)
-- 3. Seller bot (daily reports → sellers)

DROP TABLE IF EXISTS call_log;
DROP TABLE IF EXISTS sellers;

CREATE TABLE sellers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,
  notify_chat_id  TEXT,
  report_chat_id  TEXT,
  token           TEXT    NOT NULL UNIQUE,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE call_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  seller_id   INTEGER NOT NULL REFERENCES sellers(id),
  status      TEXT    NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'called', 'interested', 'rejected')),
  comment     TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_call_log_business ON call_log(business_id);
CREATE INDEX idx_call_log_seller_biz ON call_log(seller_id, business_id, created_at);
