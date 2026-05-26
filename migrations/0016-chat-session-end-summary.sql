ALTER TABLE chat_sessions ADD COLUMN message_count INTEGER;
ALTER TABLE chat_sessions ADD COLUMN intent_summary TEXT;
ALTER TABLE chat_sessions ADD COLUMN intent_categories TEXT;
ALTER TABLE chat_sessions ADD COLUMN has_complaint INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chat_sessions ADD COLUMN has_commercial_demand INTEGER NOT NULL DEFAULT 0;
