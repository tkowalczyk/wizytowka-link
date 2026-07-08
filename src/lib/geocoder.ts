import type { RunResult } from "./cron-log";
import { haversine } from "./discovery";

const BATCH_SIZE = 300;
const SLEEP_MS = 1100;
const WALL_TIME_LIMIT_MS = 12 * 60 * 1000;
const START_LAT = 52.3547;
const START_LON = 21.0822;
const USER_AGENT = "LeadGen/1.0 (kontakt@wizytowka.link)";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const MAX_BACKOFF_HOURS = 24 * 7; // 7 days

interface NominatimResult {
	place_id: number;
	licence: string;
	osm_type: string;
	osm_id: number;
	lat: string;
	lon: string;
	class: string;
	type: string;
	place_rank: number;
	importance: number;
	addresstype: string;
	name: string;
	display_name: string;
	boundingbox: string[];
}

export interface GeoResult {
	lat: number;
	lon: number;
	nominatim_place_id: number;
	osm_type: string;
	osm_id: number;
	nominatim_type: string;
	place_rank: number;
	address_type: string;
	bbox: string;
}

interface LocalityRow {
	id: number;
	name: string;
	woj_name: string;
	pow_name: string;
	gmi_name: string;
	geocode_fail_count: number;
}

export interface GeocoderDeps {
	db: D1Database;
	geocode: (loc: LocalityRow) => Promise<GeoResult | null>;
	sleepMs: number;
	wallTimeLimitMs: number;
	batchSize: number;
}

function sleep(ms: number): Promise<void> {
	if (ms <= 0) return Promise.resolve();
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function nominatimGeocode(loc: LocalityRow): Promise<GeoResult | null> {
	const q = `${loc.name}, ${loc.gmi_name}, ${loc.pow_name}, ${loc.woj_name}, Polska`;
	const url = `${NOMINATIM_URL}?${new URLSearchParams({ q, format: "json", limit: "1" })}`;
	const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });

	if (res.status === 429) throw new Error("RATE_LIMITED");
	if (!res.ok) throw new Error(`HTTP_${res.status}`);

	const data = (await res.json()) as NominatimResult[];
	if (!data.length) return null;

	const lat = parseFloat(data[0].lat);
	const lon = parseFloat(data[0].lon);
	if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
	return {
		lat,
		lon,
		nominatim_place_id: data[0].place_id,
		osm_type: data[0].osm_type,
		osm_id: data[0].osm_id,
		nominatim_type: data[0].type,
		place_rank: data[0].place_rank,
		address_type: data[0].addresstype,
		bbox: JSON.stringify(data[0].boundingbox),
	};
}

export async function nominatimWithFallback(
	loc: LocalityRow,
): Promise<GeoResult | null> {
	const primary = await nominatimGeocode(loc);
	if (primary) return primary;

	await sleep(SLEEP_MS);

	// fallback: shorter query
	const q = `${loc.name}, ${loc.woj_name}, Polska`;
	const url = `${NOMINATIM_URL}?${new URLSearchParams({ q, format: "json", limit: "1" })}`;
	const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
	// Mirror the primary: a rate-limit / server error must stop the run, not be
	// recorded as "not found" (which ratchets the locality's backoff to 7 days).
	if (res.status === 429) throw new Error("RATE_LIMITED");
	if (!res.ok) throw new Error(`HTTP_${res.status}`);

	const data = (await res.json()) as NominatimResult[];
	if (!data.length) return null;

	const lat = parseFloat(data[0].lat);
	const lon = parseFloat(data[0].lon);
	if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
	return {
		lat,
		lon,
		nominatim_place_id: data[0].place_id,
		osm_type: data[0].osm_type,
		osm_id: data[0].osm_id,
		nominatim_type: data[0].type,
		place_rank: data[0].place_rank,
		address_type: data[0].addresstype,
		bbox: JSON.stringify(data[0].boundingbox),
	};
}

export async function geocodeLocalities(deps: GeocoderDeps): Promise<RunResult>;
export async function geocodeLocalities(env: Env): Promise<RunResult>;
export async function geocodeLocalities(
	envOrDeps: Env | GeocoderDeps,
): Promise<RunResult> {
	const deps: GeocoderDeps =
		"db" in envOrDeps
			? envOrDeps
			: {
					db: envOrDeps.leadgen,
					geocode: nominatimWithFallback,
					sleepMs: SLEEP_MS,
					wallTimeLimitMs: WALL_TIME_LIMIT_MS,
					batchSize: BATCH_SIZE,
				};

	const { db, geocode, sleepMs: sleepTime, wallTimeLimitMs, batchSize } = deps;

	const { results } = await db
		.prepare(
			`SELECT id, name, woj_name, pow_name, gmi_name, geocode_fail_count
     FROM localities
     WHERE lat IS NULL
       AND geocode_failed = 0
       AND (geocode_retry_after IS NULL OR geocode_retry_after <= datetime('now'))
     ORDER BY id
     LIMIT ?`,
		)
		.bind(batchSize)
		.all<LocalityRow>();

	if (!results.length) {
		console.log("geocoder: nothing to process");
		return { processed: 0, failed: 0 };
	}

	console.log(`geocoder: starting batch of ${results.length}`);
	let processed = 0;
	let failed = 0;
	const startTime = Date.now();

	for (const loc of results) {
		if (Date.now() - startTime > wallTimeLimitMs) {
			console.log(
				`geocoder: wall-time limit reached after ${processed} localities`,
			);
			break;
		}
		try {
			const coords = await geocode(loc);

			if (!coords) {
				const newFailCount = loc.geocode_fail_count + 1;
				const backoffHours = Math.min(
					MAX_BACKOFF_HOURS,
					2 ** (newFailCount - 1),
				);
				await db
					.prepare(
						`UPDATE localities
           SET geocode_retry_after = datetime('now', '+' || ? || ' hours'),
               geocode_fail_count = ?
           WHERE id = ?`,
					)
					.bind(backoffHours, newFailCount, loc.id)
					.run();
				failed++;
			} else {
				const dist = haversine(START_LAT, START_LON, coords.lat, coords.lon);
				await db
					.prepare(
						`UPDATE localities
           SET lat = ?, lng = ?, distance_km = ?,
               nominatim_place_id = ?, osm_type = ?, osm_id = ?,
               nominatim_type = ?, place_rank = ?, address_type = ?, bbox = ?,
               geocode_fail_count = 0, geocode_retry_after = NULL
           WHERE id = ?`,
					)
					.bind(
						coords.lat,
						coords.lon,
						Math.round(dist * 100) / 100,
						coords.nominatim_place_id,
						coords.osm_type,
						coords.osm_id,
						coords.nominatim_type,
						coords.place_rank,
						coords.address_type,
						coords.bbox,
						loc.id,
					)
					.run();
				processed++;
			}

			if ((processed + failed) % 50 === 0) {
				console.log(
					`geocoder: progress ${processed + failed}/${results.length} ok=${processed} fail=${failed} elapsed=${Math.round((Date.now() - startTime) / 1000)}s`,
				);
			}

			await sleep(sleepTime);
		} catch (err) {
			if (err instanceof Error && err.message === "RATE_LIMITED") {
				console.log(
					`geocoder: rate limited after ${processed} localities, stopping`,
				);
				break;
			}
			console.log(`geocoder: error for ${loc.name} (${loc.id}): ${err}`);
			await sleep(sleepTime);
		}
	}

	const remaining = await db
		.prepare(
			`SELECT COUNT(*) as cnt FROM localities
     WHERE lat IS NULL AND geocode_failed = 0
       AND (geocode_retry_after IS NULL OR geocode_retry_after <= datetime('now'))`,
		)
		.first<{ cnt: number }>();

	console.log(
		`geocoder: processed=${processed} failed=${failed} remaining=${remaining?.cnt}`,
	);
	return { processed, failed };
}
