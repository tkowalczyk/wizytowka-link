CREATE TABLE IF NOT EXISTS chat_messages (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  locality_slug TEXT NOT NULL,
  business_slug TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('visitor', 'assistant')),
  content       TEXT NOT NULL,
  message_index INTEGER NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(session_id, message_index)
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session_index
  ON chat_messages(session_id, message_index);

CREATE INDEX IF NOT EXISTS idx_chat_messages_page_created
  ON chat_messages(locality_slug, business_slug, created_at DESC);
