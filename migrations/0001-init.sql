-- localities: ~95k miejscowosci z TERYT SIMC
CREATE TABLE IF NOT EXISTS localities (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  slug        TEXT    NOT NULL UNIQUE,
  sym         TEXT    NOT NULL UNIQUE,
  sym_pod     TEXT,
  woj         TEXT,
  woj_name    TEXT,
  pow         TEXT,
  pow_name    TEXT,
  gmi         TEXT,
  gmi_name    TEXT,
  lat            REAL,
  lng            REAL,
  distance_km    REAL,
  geocode_failed INTEGER NOT NULL DEFAULT 0,
  searched_at    TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_localities_slug ON localities(slug);
CREATE INDEX idx_localities_unsearched ON localities(searched_at, lat, distance_km)
  WHERE searched_at IS NULL AND lat IS NOT NULL;
CREATE INDEX idx_localities_ungeolocated ON localities(id)
  WHERE lat IS NULL AND geocode_failed = 0;

-- businesses: firmy znalezione przez scraper
CREATE TABLE IF NOT EXISTS businesses (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  locality_id    INTEGER NOT NULL REFERENCES localities(id),
  place_id       TEXT    NOT NULL UNIQUE,
  title          TEXT    NOT NULL,
  slug           TEXT    NOT NULL,
  phone          TEXT,
  address        TEXT,
  website        TEXT,
  category       TEXT    NOT NULL,
  rating         REAL,
  gps_lat        REAL    NOT NULL,
  gps_lng        REAL    NOT NULL,
  data_cid       TEXT,
  site_generated INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(slug, locality_id)
);

CREATE INDEX idx_businesses_locality ON businesses(locality_id);
CREATE INDEX idx_businesses_leads ON businesses(website, phone, site_generated)
  WHERE website IS NULL AND phone IS NOT NULL;
CREATE INDEX idx_businesses_place_id ON businesses(place_id);
CREATE INDEX idx_businesses_ungenerated ON businesses(id)
  WHERE website IS NULL AND phone IS NOT NULL AND site_generated = 0;

-- sellers: sprzedawcy z dostepem przez token
CREATE TABLE IF NOT EXISTS sellers (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT    NOT NULL,
  telegram_chat_id TEXT,
  token            TEXT    NOT NULL UNIQUE,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- call_log: historia kontaktow sprzedawca-firma
CREATE TABLE IF NOT EXISTS call_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  seller_id   INTEGER NOT NULL REFERENCES sellers(id),
  status      TEXT    NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'called', 'interested', 'rejected')),
  comment     TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_call_log_business ON call_log(business_id);
CREATE INDEX idx_call_log_seller_biz ON call_log(seller_id, business_id, created_at);
