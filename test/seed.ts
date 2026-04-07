/**
 * D1 seed helpers for integration tests.
 * SCHEMA_SQL represents the final state after all migrations (0001-0009).
 * SEED_SQL populates a minimal dataset covering all tables + relationships.
 */

const SCHEMA_SQL = `
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
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  nominatim_place_id INTEGER,
  osm_type    TEXT,
  osm_id      INTEGER,
  nominatim_type TEXT,
  place_rank  INTEGER,
  address_type TEXT,
  bbox        TEXT,
  geocode_retry_after TEXT,
  geocode_fail_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cron_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  cron_pattern    TEXT NOT NULL,
  started_at      TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at     TEXT,
  items_processed INTEGER DEFAULT 0,
  items_failed    INTEGER DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  error           TEXT,
  meta            TEXT
);

CREATE INDEX IF NOT EXISTS idx_cron_log_pattern ON cron_log(cron_pattern, started_at DESC);

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
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  reviews_count  INTEGER,
  google_type    TEXT,
  google_types   TEXT,
  description    TEXT,
  operating_hours TEXT,
  thumbnail_url  TEXT,
  unclaimed      INTEGER DEFAULT 0,
  palette_override TEXT,
  layout_override  TEXT CHECK (layout_override IN ('centered', 'split', 'minimal')),
  style_override   TEXT CHECK (style_override IN ('modern', 'elegant', 'bold')),
  UNIQUE(slug, locality_id)
);

CREATE TABLE IF NOT EXISTS sellers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,
  notify_chat_id  TEXT,
  report_chat_id  TEXT,
  token           TEXT    NOT NULL UNIQUE,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS call_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  seller_id   INTEGER NOT NULL REFERENCES sellers(id),
  status      TEXT    NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'called', 'interested', 'rejected')),
  comment     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS business_owners (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  chat_id     TEXT,
  token       TEXT    NOT NULL UNIQUE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS alert_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  kind    TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_alert_log_kind_sent ON alert_log(kind, sent_at DESC);
`;

const SEED_SQL = `
INSERT INTO localities (id, name, slug, sym, sym_pod, woj_name, pow_name, gmi_name, lat, lng, distance_km, searched_at)
VALUES
  (1, 'Kraków', 'krakow', '0950460', '0950460', 'małopolskie', 'Kraków', 'Kraków', 50.0647, 19.9450, 252.0, NULL),
  (2, 'Warszawa', 'warszawa', '0918123', '0918123', 'mazowieckie', 'Warszawa', 'Warszawa', 52.2297, 21.0122, 0.0, datetime('now')),
  (3, 'Wrocław', 'wroclaw', '0986283', '0986283', 'dolnośląskie', 'Wrocław', 'Wrocław', 51.1079, 17.0385, 300.0, NULL),
  (4, 'Nowa Wieś', 'nowa-wies', '1000001', '1000001', 'małopolskie', 'Kraków', 'Kraków', NULL, NULL, NULL, NULL);

INSERT INTO businesses (id, locality_id, place_id, title, slug, phone, address, website, category, rating, gps_lat, gps_lng, site_generated, reviews_count, unclaimed)
VALUES
  (1, 2, 'place_aaa', 'Hydraulik Warszawa', 'hydraulik-warszawa', '+48123456789', 'ul. Marszałkowska 1, Warszawa', NULL, 'hydraulik', 4.5, 52.2297, 21.0122, 1, 42, 0),
  (2, 2, 'place_bbb', 'Fryzjer Anna', 'fryzjer-anna', '+48987654321', 'ul. Nowy Świat 10, Warszawa', NULL, 'fryzjer', 4.8, 52.2310, 21.0150, 1, 120, 0),
  (3, 1, 'place_ccc', 'Dentysta Kraków', 'dentysta-krakow', '+48111222333', 'ul. Floriańska 5, Kraków', NULL, 'dentysta', 4.2, 50.0647, 19.9450, 0, 15, 1),
  (4, 1, 'place_ddd', 'Piekarnia Pod Bocianem', 'piekarnia-pod-bocianem', '+48444555666', 'ul. Grodzka 12, Kraków', NULL, 'piekarnia', 4.9, 50.0600, 19.9400, 1, 200, 0),
  (5, 2, 'place_eee', 'Sklep AGD', 'sklep-agd', NULL, 'ul. Puławska 50, Warszawa', 'https://sklepagd.pl', 'sklep', 3.5, 52.2100, 21.0200, 0, 5, 0),
  (6, 3, 'place_fff', 'Mechanik Wrocław', 'mechanik-wroclaw', '+48777888999', 'ul. Świdnicka 3, Wrocław', NULL, 'mechanik', 4.0, 51.1079, 17.0385, 0, 30, 1);

INSERT INTO sellers (id, name, notify_chat_id, report_chat_id, token)
VALUES
  (1, 'Jan Sprzedawca', '100001', '100001', 'seller_jan_token'),
  (2, 'Anna Sprzedawca', '100002', NULL, 'seller_anna_token');

INSERT INTO call_log (business_id, seller_id, status, comment, created_at)
VALUES
  (1, 1, 'called', 'Nie odebral', datetime('now', '-2 days')),
  (1, 1, 'interested', 'Zainteresowany, oddzwoni', datetime('now', '-1 day')),
  (3, 1, 'called', NULL, datetime('now', '-1 day')),
  (2, 2, 'rejected', 'Nie chce', datetime('now'));

INSERT INTO business_owners (id, business_id, chat_id, token)
VALUES
  (1, 1, '200001', 'biz_hydraulik_token'),
  (2, 4, NULL, 'biz_piekarnia_token');
`;

export async function applySchema(db: D1Database): Promise<void> {
	// D1 exec is picky with multi-statement SQL — split on semicolons
	const statements = SCHEMA_SQL.split(";")
		.map((s) => s.trim())
		.filter((s) => s.length > 0 && !s.startsWith("--"));
	for (const stmt of statements) {
		await db.prepare(stmt).run();
	}
}

export async function seedTestData(db: D1Database): Promise<void> {
	const statements = SEED_SQL.split(";")
		.map((s) => s.trim())
		.filter((s) => s.length > 0 && !s.startsWith("--"));
	for (const stmt of statements) {
		await db.prepare(stmt).run();
	}
}

export async function resetDb(db: D1Database): Promise<void> {
	const drops = [
		"DROP TABLE IF EXISTS alert_log",
		"DROP TABLE IF EXISTS cron_log",
		"DROP TABLE IF EXISTS call_log",
		"DROP TABLE IF EXISTS business_owners",
		"DROP TABLE IF EXISTS businesses",
		"DROP TABLE IF EXISTS sellers",
		"DROP TABLE IF EXISTS localities",
	];
	for (const stmt of drops) {
		await db.prepare(stmt).run();
	}
	await applySchema(db);
	await seedTestData(db);
}

/** Seed IDs for easy reference in tests */
export const TEST_IDS = {
	localities: {
		krakow: 1,
		warszawa: 2,
		wroclaw: 3,
		nowaWies: 4,
	},
	businesses: {
		hydraulikWarszawa: 1,
		fryzjerAnna: 2,
		dentystaKrakow: 3,
		piekarnia: 4,
		sklepAgd: 5,
		mechanikWroclaw: 6,
	},
	sellers: {
		jan: 1,
		anna: 2,
	},
	tokens: {
		sellerJan: "seller_jan_token",
		sellerAnna: "seller_anna_token",
		bizHydraulik: "biz_hydraulik_token",
		bizPiekarnia: "biz_piekarnia_token",
	},
} as const;
