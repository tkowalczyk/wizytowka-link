CREATE TABLE IF NOT EXISTS business_owners (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  chat_id     TEXT    NOT NULL UNIQUE,
  token       TEXT    NOT NULL UNIQUE,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_business_owners_chat ON business_owners(chat_id);
CREATE INDEX idx_business_owners_token ON business_owners(token);
