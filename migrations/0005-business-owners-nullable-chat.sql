CREATE TABLE business_owners_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  chat_id     TEXT,
  token       TEXT    NOT NULL UNIQUE,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO business_owners_new SELECT * FROM business_owners;
DROP TABLE business_owners;
ALTER TABLE business_owners_new RENAME TO business_owners;
CREATE UNIQUE INDEX idx_bo_chat ON business_owners(chat_id) WHERE chat_id IS NOT NULL;
CREATE INDEX idx_bo_token ON business_owners(token);
