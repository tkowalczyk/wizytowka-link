-- Removes the legacy site_generated flag now that all code paths read
-- site_status. Run AFTER 0010 has been applied and the code referencing
-- site_status is deployed. Sanity check before applying:
--   SELECT site_status, COUNT(*) FROM businesses GROUP BY site_status;
-- expected: pending + done + ineligible cover 100% of rows.

ALTER TABLE businesses DROP COLUMN site_generated;
