-- extend businesses with SerpAPI fields we already receive but don't store
ALTER TABLE businesses ADD COLUMN reviews_count INTEGER;
ALTER TABLE businesses ADD COLUMN google_type TEXT;
ALTER TABLE businesses ADD COLUMN google_types TEXT;
ALTER TABLE businesses ADD COLUMN description TEXT;
ALTER TABLE businesses ADD COLUMN operating_hours TEXT;
ALTER TABLE businesses ADD COLUMN thumbnail_url TEXT;
ALTER TABLE businesses ADD COLUMN unclaimed INTEGER DEFAULT 0;

-- unclaimed = hot leads (no Google profile management)
CREATE INDEX idx_businesses_unclaimed ON businesses(unclaimed)
  WHERE unclaimed = 1 AND website IS NULL AND phone IS NOT NULL;
