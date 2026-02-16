ALTER TABLE localities ADD COLUMN nominatim_place_id INTEGER;
ALTER TABLE localities ADD COLUMN osm_type TEXT;
ALTER TABLE localities ADD COLUMN osm_id INTEGER;
ALTER TABLE localities ADD COLUMN nominatim_type TEXT;
ALTER TABLE localities ADD COLUMN place_rank INTEGER;
ALTER TABLE localities ADD COLUMN address_type TEXT;
ALTER TABLE localities ADD COLUMN bbox TEXT;
