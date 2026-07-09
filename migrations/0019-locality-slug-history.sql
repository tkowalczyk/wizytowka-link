-- Slug history for locality URLs (#83).
--
-- Locality slugs are mutable: the hierarchical-escalation algorithm can rebase a
-- slug when a later colliding locality enters the set. Sticky slugs (frozenSlug)
-- prevent that for published localities going forward, but any slug that *does*
-- change must leave a breadcrumb so the redirect resolver can 301 old URLs
-- deterministically — including the ambiguous case where two same-name
-- localities exist and heuristics alone cannot pick one.
--
-- old_slug is the PRIMARY KEY so re-running the migration is a no-op
-- (INSERT OR IGNORE). One old_slug maps to exactly one locality.
CREATE TABLE IF NOT EXISTS locality_slug_history (
  old_slug    TEXT PRIMARY KEY,
  locality_id INTEGER NOT NULL REFERENCES localities(id),
  changed_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_slug_history_locality ON locality_slug_history(locality_id);
