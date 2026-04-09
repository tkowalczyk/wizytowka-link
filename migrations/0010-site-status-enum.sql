-- Explicit enum for site generation state. Replaces the ambiguous
-- site_generated (0/1) flag, which conflated "pending" with "ineligible"
-- rows that would never be picked by the generator (had a website or
-- missing phone). Drop of site_generated happens in 0011 after code is
-- migrated to read site_status.
--
-- Also adds site_claimed_at to support the atomic claim pattern for the
-- generator (tracked in issue #23 Phase 7) — wired later, column added
-- now so claim migration is cheap.

ALTER TABLE businesses ADD COLUMN site_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (site_status IN ('pending', 'in_progress', 'done', 'ineligible'));

ALTER TABLE businesses ADD COLUMN site_ineligible_reason TEXT
  CHECK (site_ineligible_reason IS NULL OR site_ineligible_reason IN ('has_website', 'no_phone'));

ALTER TABLE businesses ADD COLUMN site_claimed_at TEXT;

-- Backfill: priority matches classifyBusinessSiteStatus — website wins
-- over missing phone, done wins over everything (site already generated).
UPDATE businesses SET site_status = 'done'
  WHERE site_generated = 1;

UPDATE businesses SET site_status = 'ineligible', site_ineligible_reason = 'has_website'
  WHERE site_generated = 0 AND website IS NOT NULL AND website <> '';

UPDATE businesses SET site_status = 'ineligible', site_ineligible_reason = 'no_phone'
  WHERE site_generated = 0
    AND (website IS NULL OR website = '')
    AND (phone IS NULL OR phone = '');

-- Remaining site_generated=0 rows with phone present and no website keep
-- the default 'pending' status.

CREATE INDEX IF NOT EXISTS idx_businesses_pending
  ON businesses(site_status) WHERE site_status = 'pending';
