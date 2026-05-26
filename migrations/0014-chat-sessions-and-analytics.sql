CREATE TABLE IF NOT EXISTS chat_sessions (
  id                     TEXT PRIMARY KEY,
  business_id            INTEGER NOT NULL REFERENCES businesses(id),
  locality_slug          TEXT NOT NULL,
  business_slug          TEXT NOT NULL,
  started_at             TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at               TEXT,
  status                 TEXT NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'ended')),
  referrer               TEXT,
  user_agent             TEXT,
  end_reason             TEXT,
  telegram_start_sent_at TEXT,
  telegram_end_sent_at   TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_page_started
  ON chat_sessions(locality_slug, business_slug, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_status
  ON chat_sessions(status, started_at DESC);

CREATE TABLE IF NOT EXISTS analytics_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type    TEXT NOT NULL CHECK (event_type IN ('page_visit', 'chat_start')),
  locality_slug TEXT NOT NULL,
  business_slug TEXT NOT NULL,
  session_id    TEXT,
  occurred_at   TEXT NOT NULL DEFAULT (datetime('now')),
  referrer      TEXT,
  user_agent    TEXT
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_page_type
  ON analytics_events(locality_slug, business_slug, event_type, occurred_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_events_chat_start_session
  ON analytics_events(event_type, session_id)
  WHERE event_type = 'chat_start' AND session_id IS NOT NULL;
