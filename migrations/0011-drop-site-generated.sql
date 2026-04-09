-- Removes the legacy site_generated flag now that all code paths read
-- site_status. Run AFTER 0010 has been applied and the code referencing
-- site_status is deployed. Sanity check before applying:
--   SELECT site_status, COUNT(*) FROM businesses GROUP BY site_status;
-- expected: pending + done + ineligible cover 100% of rows.
--
-- Two partial indexes from 0001-init reference site_generated and must be
-- dropped before ALTER TABLE DROP COLUMN. idx_businesses_leads gets a
-- replacement (without site_generated) because lead listing still uses it.
-- idx_businesses_ungenerated is replaced by idx_businesses_pending from
-- migration 0010.

DROP INDEX IF EXISTS idx_businesses_leads;
DROP INDEX IF EXISTS idx_businesses_ungenerated;

ALTER TABLE businesses DROP COLUMN site_generated;

CREATE INDEX IF NOT EXISTS idx_businesses_leads
  ON businesses(website, phone)
  WHERE website IS NULL AND phone IS NOT NULL;
