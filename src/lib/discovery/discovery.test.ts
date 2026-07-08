import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, TEST_IDS } from "../../../test/seed";
import type { Locality } from "../../types/business";
import type { SerpApiLocalResult } from "../../types/serpapi";
import { SerpApiError } from "./errors";
import { createSerpApiSearch, runDiscovery } from "./index";
import type { DiscoveryDeps, NotifyPort, SearchPort, StatePort } from "./ports";
import { SKIP_FLAG_KEY } from "./preflight";

// -- helpers --

function fakeResult(
	overrides: Partial<SerpApiLocalResult> = {},
): SerpApiLocalResult {
	return {
		position: 1,
		title: "Test Biznes",
		place_id: "place_test_001",
		gps_coordinates: { latitude: 50.0647, longitude: 19.945 },
		phone: "+48100200300",
		address: "ul. Testowa 1, Kraków",
		...overrides,
	} satisfies SerpApiLocalResult;
}

function noopNotify(): NotifyPort {
	return { reportToSellers: async () => {} };
}

function fakeState(initial: Record<string, string> = {}) {
	const store = new Map<string, string>(Object.entries(initial));
	const port: StatePort = {
		async get(key) {
			return store.get(key) ?? null;
		},
		async put(key, value) {
			store.set(key, value);
		},
		async delete(key) {
			store.delete(key);
		},
	};
	return { port, store };
}

function staticSearch(results: SerpApiLocalResult[]): SearchPort {
	return {
		search: async () => ({ results, calls: 1 }),
	};
}

function makeDeps(overrides: Partial<DiscoveryDeps> = {}): DiscoveryDeps {
	return {
		db: env.leadgen,
		searchApi: staticSearch([]),
		notify: noopNotify(),
		categories: ["firma"],
		...overrides,
	};
}

// Wraps a D1Database and counts every prepare() — each prepared statement in
// this codebase is executed exactly once, so the count tracks D1 subrequests,
// the resource bounded by the Workers per-invocation cap (issue #63).
interface CountingD1 extends D1Database {
	readonly statementCount: number;
}

function countingD1Proxy(db: D1Database): CountingD1 {
	let count = 0;
	return new Proxy(db, {
		get(target, prop, receiver) {
			if (prop === "statementCount") return count;
			if (prop === "prepare") {
				return (query: string) => {
					count++;
					return target.prepare(query);
				};
			}
			const value = Reflect.get(target, prop, receiver);
			return typeof value === "function" ? value.bind(target) : value;
		},
	}) as unknown as CountingD1;
}

// -- tests --

describe("discovery: createSerpApiSearch", () => {
	// Issue #56 TDD assumptions:
	// Input: the SerpAPI search client can use an injected fetch and timeout for
	// boundary tests; production defaults stay in the client factory.
	// Output: a hung search rejects as SerpApiError with a timeout/abort message.
	// Boundaries: this does not test live SerpAPI latency, quota, or pagination.
	it("aborts a hung SerpAPI search request after the timeout", async () => {
		const hangingFetch = (
			_url: string | URL | Request,
			init?: RequestInit,
		): Promise<Response> => {
			return new Promise((_resolve, reject) => {
				const signal = init?.signal;
				if (signal?.aborted) {
					reject(new DOMException("Aborted", "AbortError"));
					return;
				}
				signal?.addEventListener(
					"abort",
					() => reject(new DOMException("Aborted", "AbortError")),
					{ once: true },
				);
			});
		};
		const search = createSerpApiSearch(
			{ SERP_API_KEY: "test-key" } as Env,
			hangingFetch as typeof fetch,
			20,
		);
		const locality: Locality = {
			id: 1,
			name: "Kraków",
			slug: "krakow",
			lat: 50.0647,
			lng: 19.945,
			distance_km: 0,
			searched_at: null,
		};

		await expect(
			Promise.race([
				search.search(locality, "firma"),
				new Promise((_resolve, reject) =>
					setTimeout(() => reject(new Error("test-hung")), 500),
				),
			]),
		).rejects.toThrow(/timeout|abort/i);
	});
});

describe("discovery: runDiscovery", () => {
	beforeEach(async () => {
		await resetDb(env.leadgen);
		// Kraków (id=1) is unseached, has lat/lng — eligible
		// Warszawa (id=2) already searched
	});

	it("tracer bullet: 1 search result → 1 business inserted", async () => {
		const result = fakeResult();
		const deps = makeDeps({ searchApi: staticSearch([result]) });

		const stats = await runDiscovery(deps);

		// verify DB row
		const row = await env.leadgen
			.prepare(
				"SELECT title, place_id, phone, locality_id FROM businesses WHERE place_id = ?",
			)
			.bind("place_test_001")
			.first<{
				title: string;
				place_id: string;
				phone: string;
				locality_id: number;
			}>();

		expect(row).not.toBeNull();
		expect(row?.title).toBe("Test Biznes");
		expect(row?.phone).toBe("+48100200300");
		expect(row?.locality_id).toBe(TEST_IDS.localities.krakow);

		// verify stats
		expect(stats.totalBusinesses).toBe(1);
		expect(stats.localities).toHaveLength(1);
		expect(stats.localities[0].name).toBe("Kraków");
		expect(stats.localities[0].businesses).toBe(1);
	});

	it("dedup: same place_id across categories → only 1 inserted", async () => {
		const r1 = fakeResult({ place_id: "place_dup" });
		const r2 = fakeResult({ place_id: "place_dup", title: "Inny Tytuł" });
		// Two categories, each returning the same place_id
		let callNum = 0;
		const searchApi: SearchPort = {
			search: async () => {
				callNum++;
				return { results: callNum === 1 ? [r1] : [r2], calls: 1 };
			},
		};
		const deps = makeDeps({ searchApi, categories: ["firma", "sklep"] });

		await runDiscovery(deps);

		const { results } = await env.leadgen
			.prepare("SELECT * FROM businesses WHERE place_id = 'place_dup'")
			.all();
		expect(results).toHaveLength(1);
		expect(results[0].title).toBe("Test Biznes"); // first one wins
	});

	it("site_status: classifies inserted rows by phone/website presence", async () => {
		// 4 businesses covering all classification branches
		const pendingA = fakeResult({
			title: "Classifier Pending A",
			place_id: "cls_pending_a",
			phone: "+48111111111",
			website: undefined,
		});
		const pendingB = fakeResult({
			title: "Classifier Pending B",
			place_id: "cls_pending_b",
			phone: "+48222222222",
			website: undefined,
		});
		const hasWebsite = fakeResult({
			title: "Classifier Has Website",
			place_id: "cls_has_website",
			phone: "+48333333333",
			website: "https://example.pl",
		});
		const noPhone = fakeResult({
			title: "Classifier No Phone",
			place_id: "cls_no_phone",
			phone: undefined,
			website: undefined,
		});
		const deps = makeDeps({
			searchApi: staticSearch([pendingA, pendingB, hasWebsite, noPhone]),
		});

		await runDiscovery(deps);

		const rows = await env.leadgen
			.prepare(
				"SELECT place_id, site_status, site_ineligible_reason FROM businesses WHERE place_id LIKE 'cls_%' ORDER BY place_id",
			)
			.all<{
				place_id: string;
				site_status: string;
				site_ineligible_reason: string | null;
			}>();

		expect(rows.results).toEqual([
			{
				place_id: "cls_has_website",
				site_status: "ineligible",
				site_ineligible_reason: "has_website",
			},
			{
				place_id: "cls_no_phone",
				site_status: "ineligible",
				site_ineligible_reason: "no_phone",
			},
			{
				place_id: "cls_pending_a",
				site_status: "pending",
				site_ineligible_reason: null,
			},
			{
				place_id: "cls_pending_b",
				site_status: "pending",
				site_ineligible_reason: null,
			},
		]);
	});

	it("locality resolution: address-based match preferred over GPS fallback", async () => {
		// GPS coords are near Wrocław, but address says Kraków
		const result = fakeResult({
			place_id: "place_resolve_test",
			address: "ul. Floriańska 10, Kraków",
			gps_coordinates: { latitude: 51.1079, longitude: 17.0385 }, // Wrocław coords
		});
		const deps = makeDeps({ searchApi: staticSearch([result]) });

		await runDiscovery(deps);

		const row = await env.leadgen
			.prepare("SELECT locality_id FROM businesses WHERE place_id = ?")
			.bind("place_resolve_test")
			.first<{ locality_id: number }>();
		expect(row?.locality_id).toBe(TEST_IDS.localities.krakow); // address wins over GPS
	});

	it("locality resolution: GPS fallback when address has no city", async () => {
		// Address without city, GPS near Wrocław
		const result = fakeResult({
			place_id: "place_gps_fallback",
			address: "ul. Świdnicka 3",
			gps_coordinates: { latitude: 51.1079, longitude: 17.0385 },
		});
		const deps = makeDeps({ searchApi: staticSearch([result]) });

		await runDiscovery(deps);

		const row = await env.leadgen
			.prepare("SELECT locality_id FROM businesses WHERE place_id = ?")
			.bind("place_gps_fallback")
			.first<{ locality_id: number }>();
		expect(row?.locality_id).toBe(TEST_IDS.localities.wroclaw); // GPS fallback
	});

	it("slug collision: duplicates within same batch get unique suffixes (#24)", async () => {
		// 4 businesses with identical title in the same locality, different place_ids.
		// Before the fix, generateUniqueSlug only queried the DB and didn't know about
		// slugs reserved earlier in the same batch → duplicates silently dropped by
		// INSERT OR IGNORE (UNIQUE constraint on slug + locality_id).
		const mkDup = (id: string) =>
			fakeResult({
				title: "Dup Biznes",
				place_id: id,
				address: "ul. Floriańska 1, Kraków",
				gps_coordinates: { latitude: 50.0647, longitude: 19.945 },
			});
		const deps = makeDeps({
			searchApi: staticSearch([
				mkDup("dup_001"),
				mkDup("dup_002"),
				mkDup("dup_003"),
				mkDup("dup_004"),
			]),
		});

		await runDiscovery(deps);

		const { results } = await env.leadgen
			.prepare(
				"SELECT place_id, slug FROM businesses WHERE place_id LIKE 'dup_%' ORDER BY place_id",
			)
			.all<{ place_id: string; slug: string }>();

		expect(results).toHaveLength(4);
		const slugs = results.map((r) => r.slug).sort();
		expect(slugs).toEqual([
			"dup-biznes",
			"dup-biznes-2",
			"dup-biznes-3",
			"dup-biznes-4",
		]);
	});

	it("slug collision: same title in same locality → -2 suffix", async () => {
		// Seed already has "Dentysta Kraków" (slug: dentysta-krakow) in Kraków
		const result = fakeResult({
			place_id: "place_slug_collision",
			title: "Dentysta Kraków",
			address: "ul. Floriańska 20, Kraków",
			gps_coordinates: { latitude: 50.0647, longitude: 19.945 },
		});
		const deps = makeDeps({ searchApi: staticSearch([result]) });

		await runDiscovery(deps);

		const row = await env.leadgen
			.prepare("SELECT slug FROM businesses WHERE place_id = ?")
			.bind("place_slug_collision")
			.first<{ slug: string }>();
		expect(row?.slug).toBe("dentysta-krakow-2");
	});

	it("slug generation: very long scraped titles do not trip D1 LIKE pattern limits", async () => {
		const result = fakeResult({
			place_id: "place_very_long_title",
			title: "Bardzo Długa Nazwa ".repeat(3000),
			address: "ul. Floriańska 30, Kraków",
			gps_coordinates: { latitude: 50.0647, longitude: 19.945 },
		});
		const deps = makeDeps({ searchApi: staticSearch([result]) });

		await runDiscovery(deps);

		const row = await env.leadgen
			.prepare("SELECT slug FROM businesses WHERE place_id = ?")
			.bind("place_very_long_title")
			.first<{ slug: string }>();

		expect(row).not.toBeNull();
		expect(row?.slug.length).toBeLessThanOrEqual(100);
	});

	it("apiCalls counter: non-429 error still reports partial calls without quotaExhausted", async () => {
		const goodResult = fakeResult({ place_id: "place_partial_ok" });
		let callNum = 0;
		const searchApi: SearchPort = {
			search: async () => {
				callNum++;
				if (callNum === 1) return { results: [goodResult], calls: 1 };
				// 2nd category: simulate 500 after partial pagination (2 calls done before the throw)
				throw new SerpApiError("SerpAPI 500", { calls: 2, status: 500 });
			},
		};
		const deps = makeDeps({ searchApi, categories: ["firma", "sklep"] });

		const stats = await runDiscovery(deps);

		// 1 from successful first call + 2 partial calls before 500 error
		expect(stats.totalApiCalls).toBe(3);
		expect(stats.localities[0].apiCalls).toBe(3);
		expect(stats.quotaExhausted).toBe(false);
	});

	it("apiCalls counter: SerpApiError on first call still reports 1 call", async () => {
		const searchApi: SearchPort = {
			search: async () => {
				throw new SerpApiError("SerpAPI 429 quota exhausted", {
					calls: 1,
					status: 429,
				});
			},
		};
		const deps = makeDeps({ searchApi, categories: ["firma", "sklep"] });

		const stats = await runDiscovery(deps);

		expect(stats.totalApiCalls).toBe(1);
		expect(stats.quotaExhausted).toBe(true);
		expect(stats.localities[0].apiCalls).toBe(1);
	});

	it("quota exhaustion: 429 → graceful stop, partial results persisted", async () => {
		const goodResult = fakeResult({ place_id: "place_good" });
		let callNum = 0;
		const searchApi: SearchPort = {
			search: async () => {
				callNum++;
				if (callNum === 1) return { results: [goodResult], calls: 1 };
				throw new SerpApiError("SerpAPI 429 quota exhausted", {
					calls: 1,
					status: 429,
				});
			},
		};
		const deps = makeDeps({
			searchApi,
			categories: ["firma", "sklep", "restauracja"],
		});

		const stats = await runDiscovery(deps);

		// partial results saved
		const row = await env.leadgen
			.prepare("SELECT * FROM businesses WHERE place_id = 'place_good'")
			.first();
		expect(row).not.toBeNull();

		expect(stats.quotaExhausted).toBe(true);
		expect(stats.totalBusinesses).toBe(1);
		// should not try additional localities after quota exhaustion
		expect(stats.localities).toHaveLength(1);
		// 1 successful call + 1 call before 429 throw = 2 total
		expect(stats.totalApiCalls).toBe(2);
	});

	it("hard stop: leaves locality unsearched when scrape stops mid-locality", async () => {
		// Assumptions: auth/payment/quota are hard stops, partial inserts stay
		// persisted, and retry eligibility is driven by searched_at remaining NULL.
		const goodResult = fakeResult({ place_id: "place_hard_stop_partial" });
		let callNum = 0;
		const searchApi: SearchPort = {
			search: async () => {
				callNum++;
				if (callNum === 1) return { results: [goodResult], calls: 1 };
				throw new SerpApiError("SerpAPI 429 quota exhausted", {
					calls: 1,
					status: 429,
				});
			},
		};
		const deps = makeDeps({
			searchApi,
			categories: ["firma", "sklep", "restauracja"],
		});

		await runDiscovery(deps);

		const row = await env.leadgen
			.prepare("SELECT searched_at FROM localities WHERE id = ?")
			.bind(TEST_IDS.localities.krakow)
			.first<{ searched_at: string | null }>();

		expect(row?.searched_at).toBeNull();
	});

	it("hard stop: later run retries same locality and completes all categories", async () => {
		const calls: Array<{ category: string; locality: string }> = [];
		const searchApi: SearchPort = {
			search: async (locality, category) => {
				calls.push({ category, locality: locality.name });
				if (calls.length === 1) {
					return {
						results: [fakeResult({ place_id: "place_retry_partial" })],
						calls: 1,
					};
				}
				if (calls.length === 2) {
					throw new SerpApiError("SerpAPI 429 quota exhausted", {
						calls: 1,
						status: 429,
					});
				}
				return {
					results: [
						fakeResult({
							place_id: `place_retry_${category}`,
							title: `Retry ${category}`,
						}),
					],
					calls: 1,
				};
			},
		};
		const deps = makeDeps({
			searchApi,
			categories: ["firma", "sklep", "restauracja"],
		});

		await runDiscovery(deps);
		await runDiscovery(deps);

		expect(calls).toEqual([
			{ locality: "Kraków", category: "firma" },
			{ locality: "Kraków", category: "sklep" },
			{ locality: "Kraków", category: "firma" },
			{ locality: "Kraków", category: "sklep" },
			{ locality: "Kraków", category: "restauracja" },
		]);

		const row = await env.leadgen
			.prepare("SELECT searched_at FROM localities WHERE id = ?")
			.bind(TEST_IDS.localities.krakow)
			.first<{ searched_at: string | null }>();

		expect(row?.searched_at).not.toBeNull();
	});

	it("counts only leads inserted by this run, not pre-existing same-day leads", async () => {
		// A prior run today already produced a lead-shaped business (phone, no
		// website). A second same-day run (e.g. manual POST /run-cron/discovery)
		// must not attribute that earlier lead to itself.
		await env.leadgen
			.prepare(
				"INSERT INTO businesses (locality_id, place_id, title, slug, phone, website, category, gps_lat, gps_lng, site_status) VALUES (?, ?, ?, ?, ?, NULL, ?, 0, 0, 'pending')",
			)
			.bind(
				TEST_IDS.localities.krakow,
				"place_prior_lead",
				"Prior Lead",
				"prior-lead",
				"+48500500500",
				"firma",
			)
			.run();

		// This run scrapes only a non-lead (has a website).
		const nonLead = fakeResult({
			place_id: "place_run_nonlead",
			phone: undefined,
			website: "https://example.com",
		});
		const deps = makeDeps({ searchApi: staticSearch([nonLead]) });

		const stats = await runDiscovery(deps);

		expect(stats.totalNewLeads).toBe(0);
	});

	it("multi-locality retry: 0 leads in first locality → tries next", async () => {
		// Push existing businesses to yesterday so countTodayLeads starts at 0
		await env.leadgen
			.prepare("UPDATE businesses SET created_at = datetime('now', '-1 day')")
			.run();
		// Kraków sorted first (distance_km=252), Wrocław next (300)
		// First locality: result WITH website (not a lead)
		// Second locality: result WITHOUT website but WITH phone (is a lead)
		let _localityCallCount = 0;
		const searchApi: SearchPort = {
			search: async (locality) => {
				_localityCallCount++;
				if (locality.name === "Kraków") {
					return {
						results: [
							fakeResult({
								place_id: "place_with_site",
								website: "https://example.com",
								phone: undefined,
							}),
						],
						calls: 1,
					};
				}
				// Wrocław
				return {
					results: [
						fakeResult({
							place_id: "place_lead",
							phone: "+48999000111",
							address: "ul. Świdnicka 5, Wrocław",
							gps_coordinates: { latitude: 51.1079, longitude: 17.0385 },
						}),
					],
					calls: 1,
				};
			},
		};
		const deps = makeDeps({ searchApi });

		const stats = await runDiscovery(deps);

		expect(stats.localities).toHaveLength(2);
		expect(stats.localities[0].name).toBe("Kraków");
		expect(stats.localities[1].name).toBe("Wrocław");
		expect(stats.totalNewLeads).toBeGreaterThan(0);
	});

	it("normalizes phone at insert time", async () => {
		const result = fakeResult({
			place_id: "place_phone_norm",
			phone: "500 600 700",
		});
		const deps = makeDeps({ searchApi: staticSearch([result]) });

		await runDiscovery(deps);

		const row = await env.leadgen
			.prepare("SELECT phone FROM businesses WHERE place_id = ?")
			.bind("place_phone_norm")
			.first<{ phone: string }>();
		expect(row?.phone).toBe("+48500600700");
	});

	it("stores null for invalid phone", async () => {
		const result = fakeResult({
			place_id: "place_bad_phone",
			phone: "12345",
		});
		const deps = makeDeps({ searchApi: staticSearch([result]) });

		await runDiscovery(deps);

		const row = await env.leadgen
			.prepare("SELECT phone FROM businesses WHERE place_id = ?")
			.bind("place_bad_phone")
			.first<{ phone: string | null }>();
		expect(row?.phone).toBeNull();
	});

	it('server error: continues to next category (transient), errorKind === "server"', async () => {
		const goodResult = fakeResult({ place_id: "place_after_5xx" });
		let callNum = 0;
		const searchApi: SearchPort = {
			search: async () => {
				callNum++;
				// 1st category: transient 503
				if (callNum === 1) {
					throw new SerpApiError("SerpAPI 503", {
						kind: "server",
						status: 503,
						calls: 1,
					});
				}
				// 2nd category: success
				return { results: [goodResult], calls: 1 };
			},
		};
		const deps = makeDeps({ searchApi, categories: ["firma", "sklep"] });

		const stats = await runDiscovery(deps);

		// server error did NOT short-circuit — 2nd category ran and inserted
		const row = await env.leadgen
			.prepare("SELECT place_id FROM businesses WHERE place_id = ?")
			.bind("place_after_5xx")
			.first<{ place_id: string }>();
		expect(row).not.toBeNull();

		expect(stats.errorKind).toBe("server");
		expect(stats.quotaExhausted).toBe(false);
		expect(stats.totalBusinesses).toBe(1);
		// 1 partial call from 503 + 1 successful call
		expect(stats.totalApiCalls).toBe(2);
	});

	it('payment error: stats.errorKind === "payment", locality loop stops immediately', async () => {
		const searchApi: SearchPort = {
			search: async () => {
				throw new SerpApiError("SerpAPI 402", {
					kind: "payment",
					status: 402,
					calls: 1,
				});
			},
		};
		const deps = makeDeps({ searchApi, categories: ["firma", "sklep"] });

		const stats = await runDiscovery(deps);

		expect(stats.errorKind).toBe("payment");
		expect(stats.localities).toHaveLength(1);
	});

	it('auth error: stats.errorKind === "auth", locality loop stops immediately', async () => {
		const searchApi: SearchPort = {
			search: async () => {
				throw new SerpApiError("SerpAPI 401", {
					kind: "auth",
					status: 401,
					calls: 1,
				});
			},
		};
		const deps = makeDeps({ searchApi, categories: ["firma", "sklep"] });

		const stats = await runDiscovery(deps);

		expect(stats.errorKind).toBe("auth");
		// hard stop: should NOT advance to additional localities
		expect(stats.localities).toHaveLength(1);
	});

	it("preflight skip flag set → returns empty stats with errorKind=preflight-skip", async () => {
		const { port } = fakeState({
			[SKIP_FLAG_KEY]: JSON.stringify({ searchesLeft: 50, threshold: 200 }),
		});
		const deps = makeDeps({ state: port });

		const stats = await runDiscovery(deps);

		expect(stats.errorKind).toBe("preflight-skip");
		expect(stats.localities).toEqual([]);
		expect(stats.totalApiCalls).toBe(0);
		expect(stats.totalBusinesses).toBe(0);
		expect(stats.totalNewLeads).toBe(0);
		expect(stats.quotaExhausted).toBe(false);
		expect(stats.searchesLeft).toBe(50);
	});

	it("preflight skip flag set → searchApi.search is never called", async () => {
		const { port } = fakeState({
			[SKIP_FLAG_KEY]: JSON.stringify({ searchesLeft: 10 }),
		});
		let calls = 0;
		const searchApi: SearchPort = {
			search: async () => {
				calls++;
				return { results: [], calls: 1 };
			},
		};
		const deps = makeDeps({ state: port, searchApi });

		await runDiscovery(deps);

		expect(calls).toBe(0);
	});

	it("preflight skip flag set → notify.reportToSellers is NOT called", async () => {
		const { port } = fakeState({
			[SKIP_FLAG_KEY]: JSON.stringify({ searchesLeft: 10 }),
		});
		let notified = false;
		const notify: NotifyPort = {
			reportToSellers: async () => {
				notified = true;
			},
		};
		const deps = makeDeps({ state: port, notify });

		await runDiscovery(deps);

		expect(notified).toBe(false);
	});

	it("preflight skip flag set → flag is cleared after run", async () => {
		const { port, store } = fakeState({
			[SKIP_FLAG_KEY]: JSON.stringify({ searchesLeft: 10 }),
		});
		const deps = makeDeps({ state: port });

		await runDiscovery(deps);

		expect(store.has(SKIP_FLAG_KEY)).toBe(false);
	});

	it("report: NotifyPort.reportToSellers called with correct stats", async () => {
		const result = fakeResult({ place_id: "place_report_test" });
		let reportedStats: unknown = null;
		const notify: NotifyPort = {
			reportToSellers: async (stats) => {
				reportedStats = stats;
			},
		};
		const deps = makeDeps({ searchApi: staticSearch([result]), notify });

		const stats = await runDiscovery(deps);

		expect(reportedStats).not.toBeNull();
		expect(reportedStats).toEqual(stats);
	});

	it("stays within a bounded number of D1 statements regardless of result volume (#63)", async () => {
		// A big locality can yield hundreds of unique results. If resolution +
		// slug lookups run per result (2–4 D1 calls each) the run blows the
		// Workers subrequest cap and persists nothing. Pin the design property:
		// non-insert D1 work must be O(distinct cities + slug chunks), not
		// O(results). The only term allowed to scale with volume is the
		// INSERT chunking floor (ceil(N / BATCH_SIZE)).
		const VOLUME = 200;
		const results = Array.from({ length: VOLUME }, (_, i) =>
			fakeResult({
				place_id: `place_vol_${i}`,
				title: `Firma Numer ${i}`,
				address: "ul. Testowa 1, Kraków",
				gps_coordinates: { latitude: 50.0647, longitude: 19.945 },
			}),
		);
		const counted = countingD1Proxy(env.leadgen);
		const deps = makeDeps({ db: counted, searchApi: staticSearch(results) });

		await runDiscovery(deps);

		// All rows persisted (nothing dropped by an aborted run).
		const row = await env.leadgen
			.prepare(
				"SELECT COUNT(*) AS cnt FROM businesses WHERE place_id LIKE 'place_vol_%'",
			)
			.first<{ cnt: number }>();
		expect(row?.cnt).toBe(VOLUME);

		// Budget = the irreducible INSERT floor (200 rows / BATCH_SIZE 4 = 50
		// statements) + a small overhead that must stay *sublinear* in result
		// volume: resolution memoized to O(distinct cities), slug collisions to
		// O(distinctBases / chunk) batched lookups, plus a few bookkeeping
		// queries. Measured today: 59 (50 inserts + 5 slug chunks + 4 fixed).
		// The pre-fix per-result path issued 453. Any surviving per-result DB
		// call would add >= VOLUME (200) statements, so this threshold catches
		// a regression while tolerating slug-chunk-size tuning.
		const INSERT_FLOOR = Math.ceil(VOLUME / 4);
		expect(counted.statementCount).toBeLessThan(INSERT_FLOOR + 20);
	});

	it("a 1,500-result locality completes within the Workers subrequest cap (#63)", async () => {
		// The biggest cities come first in the locality queue, so a run must
		// survive the worst realistic volume without blowing the 1000-subrequest
		// cap (D1 calls count). Statement count is bounded by ceil(N/BATCH_SIZE)
		// inserts + sublinear resolution/slug work, not the 2–4×N of the bug.
		const VOLUME = 1500;
		const SUBREQUEST_CAP = 1000;
		const results = Array.from({ length: VOLUME }, (_, i) =>
			fakeResult({
				place_id: `place_big_${i}`,
				title: `Wielki Biznes ${i}`,
				address: "ul. Testowa 1, Kraków",
				gps_coordinates: { latitude: 50.0647, longitude: 19.945 },
			}),
		);
		const counted = countingD1Proxy(env.leadgen);
		const deps = makeDeps({ db: counted, searchApi: staticSearch(results) });

		await runDiscovery(deps);

		const row = await env.leadgen
			.prepare(
				"SELECT COUNT(*) AS cnt FROM businesses WHERE place_id LIKE 'place_big_%'",
			)
			.first<{ cnt: number }>();
		expect(row?.cnt).toBe(VOLUME);
		expect(counted.statementCount).toBeLessThan(SUBREQUEST_CAP);
	});
});
