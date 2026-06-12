/**
 * D1 seed helpers for integration tests.
 * applySchema runs the production migrations so tests use the production schema.
 * SEED_SQL populates a minimal dataset covering all tables + relationships.
 */

const migrationFiles = import.meta.glob("../migrations/*.sql", {
	query: "?raw",
	import: "default",
	eager: true,
}) as Record<string, string>;

function sqlStatements(sql: string): string[] {
	return sql
		.split(";")
		.map((statement) => statement.replace(/^\s*--.*$/gm, "").trim())
		.filter(Boolean);
}

const SEED_SQL = `
INSERT INTO localities (id, name, slug, sym, sym_pod, woj_name, pow_name, gmi_name, lat, lng, distance_km, searched_at)
VALUES
  (1, 'Kraków', 'krakow', '0950460', '0950460', 'małopolskie', 'Kraków', 'Kraków', 50.0647, 19.9450, 252.0, NULL),
  (2, 'Warszawa', 'warszawa', '0918123', '0918123', 'mazowieckie', 'Warszawa', 'Warszawa', 52.2297, 21.0122, 0.0, datetime('now')),
  (3, 'Wrocław', 'wroclaw', '0986283', '0986283', 'dolnośląskie', 'Wrocław', 'Wrocław', 51.1079, 17.0385, 300.0, NULL),
  (4, 'Nowa Wieś', 'nowa-wies', '1000001', '1000001', 'małopolskie', 'Kraków', 'Kraków', NULL, NULL, NULL, NULL);

INSERT INTO businesses (id, locality_id, place_id, title, slug, phone, address, website, category, rating, gps_lat, gps_lng, site_status, site_ineligible_reason, reviews_count, unclaimed)
VALUES
  (1, 2, 'place_aaa', 'Hydraulik Warszawa', 'hydraulik-warszawa', '+48123456789', 'ul. Marszałkowska 1, Warszawa', NULL, 'hydraulik', 4.5, 52.2297, 21.0122, 'done', NULL, 42, 0),
  (2, 2, 'place_bbb', 'Fryzjer Anna', 'fryzjer-anna', '+48987654321', 'ul. Nowy Świat 10, Warszawa', NULL, 'fryzjer', 4.8, 52.2310, 21.0150, 'done', NULL, 120, 0),
  (3, 1, 'place_ccc', 'Dentysta Kraków', 'dentysta-krakow', '+48111222333', 'ul. Floriańska 5, Kraków', NULL, 'dentysta', 4.2, 50.0647, 19.9450, 'pending', NULL, 15, 1),
  (4, 1, 'place_ddd', 'Piekarnia Pod Bocianem', 'piekarnia-pod-bocianem', '+48444555666', 'ul. Grodzka 12, Kraków', NULL, 'piekarnia', 4.9, 50.0600, 19.9400, 'done', NULL, 200, 0),
  (5, 2, 'place_eee', 'Sklep AGD', 'sklep-agd', NULL, 'ul. Puławska 50, Warszawa', 'https://sklepagd.pl', 'sklep', 3.5, 52.2100, 21.0200, 'ineligible', 'has_website', 5, 0),
  (6, 3, 'place_fff', 'Mechanik Wrocław', 'mechanik-wroclaw', '+48777888999', 'ul. Świdnicka 3, Wrocław', NULL, 'mechanik', 4.0, 51.1079, 17.0385, 'pending', NULL, 30, 1);

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
	const orderedMigrations = Object.entries(migrationFiles).sort(([a], [b]) =>
		a.localeCompare(b),
	);

	for (const [, migrationSql] of orderedMigrations) {
		for (const statement of sqlStatements(migrationSql)) {
			await db.prepare(statement).run();
		}
	}
}

export async function seedTestData(db: D1Database): Promise<void> {
	for (const statement of sqlStatements(SEED_SQL)) {
		await db.prepare(statement).run();
	}
}

export async function resetDb(db: D1Database): Promise<void> {
	const drops = [
		"DROP TABLE IF EXISTS chat_messages",
		"DROP TABLE IF EXISTS analytics_events",
		"DROP TABLE IF EXISTS chat_sessions",
		"DROP TABLE IF EXISTS alert_log",
		"DROP TABLE IF EXISTS draft_preview_tokens",
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
