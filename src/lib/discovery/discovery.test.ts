import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, TEST_IDS } from "../../../test/seed";
import type { SerpApiLocalResult } from "../../types/serpapi";
import { SerpApiError } from "./errors";
import { runDiscovery } from "./index";
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

// -- tests --

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
});
