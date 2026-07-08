export type {
	DiscoveryDeps,
	DiscoveryStats,
	LocalityStats,
	NotifyPort,
	SearchPort,
} from "./ports";

import type { BusinessInsert, Locality, SellerRow } from "../../types/business";
import type {
	SerpApiLocalResult,
	SerpApiMapsResponse,
} from "../../types/serpapi";
import { getCronSummary } from "../cron-log";
import { normalizePhone } from "../phone";
import { classifyBusinessSiteStatus } from "../site-status";
import { slugify } from "../slug";
import type { DailyReportStats, LeadSummary } from "../telegram";
import { formatCronSection, sendDailyReport } from "../telegram";
import { SerpApiError } from "./errors";
import type {
	DiscoveryDeps,
	DiscoveryErrorKind,
	DiscoveryStats,
	LocalityStats,
	NotifyPort,
	SearchPort,
} from "./ports";
import { kvStatePort, SKIP_FLAG_KEY } from "./preflight";

export { SerpApiError } from "./errors";

// BATCH_SIZE × columns per row must stay <= 100 (D1 param limit).
// 4 × 21 = 84, safe. Previously 5 × 19 = 95.
const BATCH_SIZE = 4;
const MAX_LOCALITY_ATTEMPTS = 5;
const SERPAPI_BASE = "https://serpapi.com/search.json";
const MAX_PAGES_PER_CATEGORY = 5;
export const SERPAPI_SEARCH_TIMEOUT_MS = 30 * 1000;

const DEFAULT_CATEGORIES = [
	"firma",
	"sklep",
	"restauracja",
	"hydraulik",
	"elektryk",
	"mechanik",
	"fryzjer",
	"dentysta",
	"weterynarz",
	"kwiaciarnia",
	"piekarnia",
	"zakład pogrzebowy",
	"fotograf",
	"księgowość",
	"fizjoterapia",
	"przedszkole",
	"autokomis",
	"usługi",
];

export function createSerpApiSearch(
	env: Pick<Env, "SERP_API_KEY">,
	fetchImpl: typeof fetch = fetch,
	timeoutMs = SERPAPI_SEARCH_TIMEOUT_MS,
): SearchPort {
	return {
		async search(locality, category) {
			const results: SerpApiLocalResult[] = [];
			const q = encodeURIComponent(`${category} ${locality.name}`);
			let url: string | null =
				`${SERPAPI_BASE}?engine=google_maps&q=${q}&ll=@${locality.lat},${locality.lng},14z&api_key=${env.SERP_API_KEY}`;
			let page = 0;
			let calls = 0;
			try {
				while (url && page < MAX_PAGES_PER_CATEGORY) {
					calls++;
					const controller = new AbortController();
					const timer = setTimeout(() => controller.abort(), timeoutMs);
					let res: Response;
					try {
						res = await fetchImpl(url, { signal: controller.signal });
					} catch (err) {
						if (
							controller.signal.aborted ||
							(err instanceof Error && err.name === "AbortError")
						) {
							throw new SerpApiError(`SerpAPI timeout after ${timeoutMs}ms`, {
								calls,
							});
						}
						throw err;
					} finally {
						clearTimeout(timer);
					}
					if (!res.ok)
						throw new SerpApiError(`SerpAPI ${res.status}`, {
							calls,
							status: res.status,
						});
					const data: SerpApiMapsResponse = await res.json();
					if (data.local_results) results.push(...data.local_results);
					const next = data.serpapi_pagination?.next ?? null;
					url = next ? `${next}&api_key=${env.SERP_API_KEY}` : null;
					page++;
				}
			} catch (err) {
				if (err instanceof SerpApiError) throw err;
				throw new SerpApiError(
					err instanceof Error ? err.message : String(err),
					{ calls },
				);
			}
			return { results, calls };
		},
	};
}

function createTelegramNotify(env: Env): NotifyPort {
	return {
		async reportToSellers(stats) {
			const totalResult = await env.leadgen
				.prepare(
					"SELECT COUNT(*) as cnt FROM businesses WHERE created_at >= date('now')",
				)
				.first<{ cnt: number }>();

			const newLeads = stats.totalNewLeads;

			const topLeads = await env.leadgen
				.prepare(`
        SELECT title, category, phone FROM businesses
        WHERE website IS NULL AND phone IS NOT NULL AND created_at >= date('now')
        ORDER BY id DESC LIMIT 5
      `)
				.all<LeadSummary>();

			const cronStats = await getCronSummary(env.leadgen);
			const cronSection = formatCronSection(cronStats, {
				"0 * * * *": "Geocoder",
				"0 8 * * *": "Discovery",
				"*/5 * * * *": "Generator",
				"0 9 * * 1": "Funnel",
			});

			const reportStats: DailyReportStats = {
				locality_name: stats.localities.map((l) => l.name).join(", "),
				total_businesses: totalResult?.cnt ?? 0,
				new_leads: newLeads,
				top_leads: topLeads.results,
				cronSection,
				quotaExhausted: stats.quotaExhausted,
			};

			const sellers = await env.leadgen
				.prepare(
					"SELECT id, name, report_chat_id, token FROM sellers WHERE report_chat_id IS NOT NULL",
				)
				.all<SellerRow>();

			await fanOutDailyReports(
				env.TG_SELLER_BOT_TOKEN,
				sellers.results,
				reportStats,
			);
		},
	};
}

export type SendDailyReportFn = (
	token: string,
	seller: SellerRow,
	stats: DailyReportStats,
) => Promise<void>;

export async function fanOutDailyReports(
	token: string,
	sellers: SellerRow[],
	stats: DailyReportStats,
	send: SendDailyReportFn = sendDailyReport,
): Promise<void> {
	const results = await Promise.allSettled(
		sellers.map((seller) => send(token, seller, stats)),
	);
	for (let i = 0; i < results.length; i++) {
		const r = results[i];
		if (r.status === "rejected") {
			console.log(`telegram: failed for seller ${sellers[i].id}: ${r.reason}`);
		}
	}
}

export function createDiscoveryDeps(env: Env): DiscoveryDeps {
	return {
		db: env.leadgen,
		searchApi: createSerpApiSearch(env),
		notify: createTelegramNotify(env),
		categories: DEFAULT_CATEGORIES,
		state: env.STATE ? kvStatePort(env.STATE) : undefined,
	};
}

export async function runDiscovery(
	deps: DiscoveryDeps,
): Promise<DiscoveryStats> {
	const { db, searchApi, categories } = deps;

	// Pre-flight skip — if quota check earlier today set the skip flag, bail out before
	// burning a single SerpAPI call. The flag carries searchesLeft so the alert is precise.
	const skipPayload = deps.state ? await deps.state.get(SKIP_FLAG_KEY) : null;
	if (skipPayload) {
		let searchesLeft: number | null = null;
		try {
			searchesLeft =
				(JSON.parse(skipPayload) as { searchesLeft?: number | null })
					.searchesLeft ?? null;
		} catch {}
		await deps.state?.delete(SKIP_FLAG_KEY);
		return {
			localities: [],
			totalApiCalls: 0,
			totalBusinesses: 0,
			totalNewLeads: 0,
			quotaExhausted: false,
			errorKind: "preflight-skip",
			searchesLeft,
		};
	}

	const localityStats: LocalityStats[] = [];
	let totalApiCalls = 0;
	let errorKind: DiscoveryErrorKind | null = null;
	let hardStop = false;

	for (let attempt = 0; attempt < MAX_LOCALITY_ATTEMPTS; attempt++) {
		const locality = await getNextLocality(db);
		if (!locality) break;

		const seen = new Set<string>();
		// Collect raw results across all categories first, then resolve
		// localities + assign slugs in one batched pass. Doing that DB work per
		// result (2–4 queries each) can blow the Workers subrequest cap on a
		// large locality and abort the whole run after the SerpAPI spend (#63).
		const rawResults: Array<{ result: SerpApiLocalResult; category: string }> =
			[];
		let apiCalls = 0;

		for (const category of categories) {
			if (hardStop) break;
			try {
				const { results, calls } = await searchApi.search(locality, category);
				apiCalls += calls;
				for (const r of results) {
					if (seen.has(r.place_id)) continue;
					seen.add(r.place_id);
					rawResults.push({ result: r, category });
				}
			} catch (err) {
				if (err instanceof SerpApiError) {
					apiCalls += err.calls;
					errorKind = err.kind;
					if (
						err.kind === "auth" ||
						err.kind === "payment" ||
						err.kind === "quota"
					) {
						hardStop = true;
						break;
					}
				}
				console.error(`[discovery] ${category}@${locality.name}: ${err}`);
			}
		}

		const businesses = await buildBusinesses(db, locality.id, rawResults);
		await batchInsert(db, businesses);
		if (!hardStop) await markSearched(db, locality.id);

		const newLeads = await countTodayLeads(db);
		totalApiCalls += apiCalls;
		localityStats.push({
			name: locality.name,
			businesses: businesses.length,
			apiCalls,
			newLeads,
		});

		if (newLeads > 0 || hardStop) break;
	}

	const stats: DiscoveryStats = {
		localities: localityStats,
		totalApiCalls,
		totalBusinesses: localityStats.reduce((s, l) => s + l.businesses, 0),
		totalNewLeads: localityStats.reduce((s, l) => s + l.newLeads, 0),
		quotaExhausted: errorKind === "quota",
		errorKind,
	};

	if (localityStats.length > 0) {
		await deps.notify.reportToSellers(stats);
	}

	return stats;
}

export async function discoverBusinesses(env: Env): Promise<DiscoveryStats> {
	return runDiscovery(createDiscoveryDeps(env));
}

// -- internal: locality resolution --

interface LocalityMatch {
	id: number;
	name: string;
	slug: string;
}

export function haversine(
	lat1: number,
	lon1: number,
	lat2: number,
	lon2: number,
): number {
	const R = 6371;
	const dLat = ((lat2 - lat1) * Math.PI) / 180;
	const dLon = ((lon2 - lon1) * Math.PI) / 180;
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos((lat1 * Math.PI) / 180) *
			Math.cos((lat2 * Math.PI) / 180) *
			Math.sin(dLon / 2) ** 2;
	return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const SKIP_PARTS = new Set([
	"polska",
	"poland",
	"pl",
	"dolnośląskie",
	"kujawsko-pomorskie",
	"lubelskie",
	"lubuskie",
	"łódzkie",
	"małopolskie",
	"mazowieckie",
	"opolskie",
	"podkarpackie",
	"podlaskie",
	"pomorskie",
	"śląskie",
	"świętokrzyskie",
	"warmińsko-mazurskie",
	"wielkopolskie",
	"zachodniopomorskie",
]);

const STREET_PREFIXES = ["ul.", "ul", "al.", "al", "os.", "os", "pl.", "pl"];

function parseCityFromAddress(address: string | null): string | null {
	if (!address) return null;
	const parts = address
		.split(",")
		.map((p) => p.trim())
		.filter(Boolean);
	for (let i = parts.length - 1; i >= 0; i--) {
		const part = parts[i];
		const lower = part.toLowerCase();
		if (SKIP_PARTS.has(lower)) continue;
		if (/^\d{2}-\d{3}$/.test(part)) continue;
		const postalMatch = part.match(/^\d{2}-\d{3}\s+(.+)$/);
		if (postalMatch) return postalMatch[1].trim();
		const firstWord = lower.split(/\s+/)[0];
		if (STREET_PREFIXES.includes(firstWord)) continue;
		if (/\d/.test(part)) continue;
		return part;
	}
	return null;
}

async function matchLocalityByName(
	db: D1Database,
	cityName: string,
	lat?: number | null,
	lng?: number | null,
): Promise<LocalityMatch | null> {
	const { results } = await db
		.prepare(
			"SELECT id, name, slug, lat, lng FROM localities WHERE name = ? COLLATE NOCASE AND sym = sym_pod",
		)
		.bind(cityName)
		.all<LocalityMatch & { lat: number | null; lng: number | null }>();
	if (!results.length) return null;
	if (results.length === 1)
		return { id: results[0].id, name: results[0].name, slug: results[0].slug };
	if (lat != null && lng != null) {
		const withCoords = results.filter(
			(
				r,
			): r is LocalityMatch & {
				lat: number;
				lng: number;
			} => r.lat != null && r.lng != null,
		);
		if (withCoords.length) {
			let best = withCoords[0];
			let bestDist = haversine(lat, lng, best.lat, best.lng);
			for (let i = 1; i < withCoords.length; i++) {
				const d = haversine(lat, lng, withCoords[i].lat, withCoords[i].lng);
				if (d < bestDist) {
					bestDist = d;
					best = withCoords[i];
				}
			}
			return { id: best.id, name: best.name, slug: best.slug };
		}
	}
	return null;
}

async function matchLocalityByGps(
	db: D1Database,
	lat: number,
	lng: number,
): Promise<LocalityMatch | null> {
	const NARROW = 0.15;
	const WIDE = 0.5;
	let { results } = await db
		.prepare(
			"SELECT id, name, slug, lat, lng FROM localities WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ? AND sym = sym_pod",
		)
		.bind(lat - NARROW, lat + NARROW, lng - NARROW, lng + NARROW)
		.all<LocalityMatch & { lat: number; lng: number }>();
	if (!results.length) {
		({ results } = await db
			.prepare(
				"SELECT id, name, slug, lat, lng FROM localities WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ? AND sym = sym_pod",
			)
			.bind(lat - WIDE, lat + WIDE, lng - WIDE, lng + WIDE)
			.all<LocalityMatch & { lat: number; lng: number }>());
	}
	if (!results.length) return null;
	let best = results[0];
	let bestDist = haversine(lat, lng, best.lat, best.lng);
	for (let i = 1; i < results.length; i++) {
		const d = haversine(lat, lng, results[i].lat, results[i].lng);
		if (d < bestDist) {
			bestDist = d;
			best = results[i];
		}
	}
	return { id: best.id, name: best.name, slug: best.slug };
}

async function resolveLocality(
	db: D1Database,
	address: string | null,
	lat: number | null,
	lng: number | null,
): Promise<LocalityMatch | null> {
	const city = parseCityFromAddress(address);
	if (city) {
		const match = await matchLocalityByName(db, city, lat, lng);
		if (match) return match;
	}
	if (lat != null && lng != null) return matchLocalityByGps(db, lat, lng);
	return null;
}

// Memoize resolution by parsed city (falling back to a GPS bucket when the
// address has no city). A single discovery run is geographically focused on one
// town, so results collapse to a handful of distinct keys — turning O(results)
// locality queries into O(distinct cities). When several results share a city
// the first one's coordinates settle any same-name disambiguation for the rest.
async function resolveLocalityCached(
	db: D1Database,
	cache: Map<string, number>,
	address: string | null,
	lat: number | null,
	lng: number | null,
	fallbackLocalityId: number,
): Promise<number> {
	const city = parseCityFromAddress(address);
	const key = city
		? `n:${city.toLowerCase()}`
		: lat != null && lng != null
			? `g:${lat.toFixed(2)}:${lng.toFixed(2)}`
			: "null";
	const cached = cache.get(key);
	if (cached !== undefined) return cached;
	const match = await resolveLocality(db, address, lat, lng);
	const localityId = match?.id ?? fallbackLocalityId;
	cache.set(key, localityId);
	return localityId;
}

// Turn raw scraped results into insert rows: resolve each result's locality
// (memoized), then assign collision-free slugs per locality group with one
// batched lookup instead of a query per result (#63).
async function buildBusinesses(
	db: D1Database,
	fallbackLocalityId: number,
	rawResults: Array<{ result: SerpApiLocalResult; category: string }>,
): Promise<BusinessInsert[]> {
	const resolveCache = new Map<string, number>();
	const prepared: Array<{
		result: SerpApiLocalResult;
		category: string;
		localityId: number;
		base: string;
	}> = [];
	for (const { result, category } of rawResults) {
		const localityId = await resolveLocalityCached(
			db,
			resolveCache,
			result.address ?? null,
			result.gps_coordinates.latitude,
			result.gps_coordinates.longitude,
			fallbackLocalityId,
		);
		prepared.push({
			result,
			category,
			localityId,
			base: businessSlugBase(result.title),
		});
	}

	const byLocality = new Map<number, typeof prepared>();
	for (const item of prepared) {
		const group = byLocality.get(item.localityId);
		if (group) group.push(item);
		else byLocality.set(item.localityId, [item]);
	}

	const businesses: BusinessInsert[] = [];
	for (const [localityId, group] of byLocality) {
		const existing = await fetchExistingSlugs(
			db,
			localityId,
			group.map((i) => i.base),
		);
		// Slugs handed out within this batch, so intra-run duplicates get
		// -2/-3/… suffixes instead of silently colliding on the DB
		// UNIQUE(slug, locality_id) via INSERT OR IGNORE.
		const reserved = new Set<string>();
		for (const item of group) {
			const slug = assignSlug(item.base, existing, reserved);
			reserved.add(slug);
			businesses.push(toBusiness(item.result, slug, localityId, item.category));
		}
	}
	return businesses;
}

// -- internal: slug --

const MAX_SLUG_ATTEMPTS = 50;
const MAX_SLUG_BASE_LENGTH = 96;

function businessSlugBase(title: string): string {
	const base = slugify(title)
		.slice(0, MAX_SLUG_BASE_LENGTH)
		.replace(/-+$/g, "");
	return base || "firma";
}

// 45 bases × 2 range bounds + 1 locality = 91, under the D1 100-param-per-
// statement cap. Chunk distinct bases so one locality needs only
// ceil(distinctBases / 45) collision lookups instead of one query per result.
const SLUG_BASE_CHUNK = 45;

// Fetch every existing slug in this locality that could collide with one of the
// desired bases — the base itself or any "base-N" suffix. Uses a range match
// rather than LIKE: a base and its "base-N" suffixes all sort into
// [base, base + "."), since "-" (0x2D) is the lowest slug char and "." (0x2E)
// sits just above it (slugs are [a-z0-9-] under BINARY collation). LIKE would
// trip D1's low LIKE-pattern-length cap on long scraped titles (#24).
async function fetchExistingSlugs(
	db: D1Database,
	localityId: number,
	bases: string[],
): Promise<Set<string>> {
	const distinct = [...new Set(bases)];
	const existing = new Set<string>();
	for (let i = 0; i < distinct.length; i += SLUG_BASE_CHUNK) {
		const chunk = distinct.slice(i, i + SLUG_BASE_CHUNK);
		const conds = chunk.map(() => "(slug >= ? AND slug < ?)").join(" OR ");
		const params: string[] = [];
		for (const base of chunk) params.push(base, `${base}.`);
		const { results } = await db
			.prepare(
				`SELECT slug FROM businesses WHERE locality_id = ? AND (${conds})`,
			)
			.bind(localityId, ...params)
			.all<{ slug: string }>();
		for (const r of results) existing.add(r.slug);
	}
	return existing;
}

// Pick the first free slug for `base`: the base, else base-2, base-3, …, using
// slugs already in the DB (`existing`) and those handed out earlier in this
// batch (`reserved`). Mirrors the previous per-row suffixing behaviour.
function assignSlug(
	base: string,
	existing: ReadonlySet<string>,
	reserved: ReadonlySet<string>,
): string {
	const taken = (slug: string) => existing.has(slug) || reserved.has(slug);
	if (!taken(base)) return base;
	for (let suffix = 2; suffix <= MAX_SLUG_ATTEMPTS + 1; suffix++) {
		const candidate = `${base}-${suffix}`;
		if (!taken(candidate)) return candidate;
	}
	throw new Error(`slug collision limit exceeded: ${base}`);
}

// -- internal: DB helpers --

async function getNextLocality(db: D1Database): Promise<Locality | null> {
	return db
		.prepare(
			"SELECT * FROM localities WHERE searched_at IS NULL AND lat IS NOT NULL AND geocode_failed = 0 ORDER BY distance_km LIMIT 1",
		)
		.first<Locality>();
}

async function countTodayLeads(db: D1Database): Promise<number> {
	const r = await db
		.prepare(
			"SELECT COUNT(*) as cnt FROM businesses WHERE website IS NULL AND phone IS NOT NULL AND created_at >= date('now')",
		)
		.first<{ cnt: number }>();
	return r?.cnt ?? 0;
}

async function markSearched(db: D1Database, localityId: number): Promise<void> {
	await db
		.prepare("UPDATE localities SET searched_at = datetime('now') WHERE id = ?")
		.bind(localityId)
		.run();
}

function toBusiness(
	r: SerpApiLocalResult,
	slug: string,
	localityId: number,
	category: string,
): BusinessInsert {
	const phone = r.phone ? normalizePhone(r.phone) : null;
	const website = r.website ?? null;
	const classification = classifyBusinessSiteStatus({ website, phone });
	return {
		title: r.title,
		slug,
		phone,
		address: r.address ?? null,
		website,
		category,
		rating: r.rating ?? null,
		gps_lat: r.gps_coordinates.latitude,
		gps_lng: r.gps_coordinates.longitude,
		place_id: r.place_id,
		data_cid: r.data_cid ?? null,
		locality_id: localityId,
		reviews_count: r.reviews ?? null,
		google_type: r.type ?? null,
		google_types: r.types ? JSON.stringify(r.types) : null,
		description: r.description ?? null,
		operating_hours: r.operating_hours
			? JSON.stringify(r.operating_hours)
			: null,
		thumbnail_url: r.thumbnail ?? null,
		unclaimed: r.unclaimed_listing ? 1 : 0,
		site_status: classification.status,
		site_ineligible_reason: classification.reason,
	};
}

async function batchInsert(
	db: D1Database,
	businesses: BusinessInsert[],
): Promise<void> {
	for (let i = 0; i < businesses.length; i += BATCH_SIZE) {
		const chunk = businesses.slice(i, i + BATCH_SIZE);
		const placeholders = chunk
			.map(
				() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			)
			.join(", ");
		const values = chunk.flatMap((b) => [
			b.title,
			b.slug,
			b.phone,
			b.address,
			b.website,
			b.category,
			b.rating,
			b.gps_lat,
			b.gps_lng,
			b.place_id,
			b.data_cid,
			b.locality_id,
			b.reviews_count,
			b.google_type,
			b.google_types,
			b.description,
			b.operating_hours,
			b.thumbnail_url,
			b.unclaimed,
			b.site_status,
			b.site_ineligible_reason,
		]);
		await db
			.prepare(
				`INSERT OR IGNORE INTO businesses
       (title, slug, phone, address, website, category, rating,
        gps_lat, gps_lng, place_id, data_cid, locality_id,
        reviews_count, google_type, google_types, description,
        operating_hours, thumbnail_url, unclaimed,
        site_status, site_ineligible_reason)
       VALUES ${placeholders}`,
			)
			.bind(...values)
			.run();
	}
}
