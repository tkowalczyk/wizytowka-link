import { describe, expect, it, vi } from "vitest";
import {
	type AccountHealth,
	type CachePort,
	fetchSerpApiAccount,
	getCachedAccountHealth,
} from "./account";

function okResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

describe("fetchSerpApiAccount", () => {
	it("returns status: ok when total_searches_left >= 500", async () => {
		const fakeFetch = async (_url: string | URL | Request) =>
			okResponse({
				account_id: "acc-123",
				plan_id: "developer",
				searches_per_month: 5000,
				plan_searches_left: 4231,
				total_searches_left: 4231,
				this_month_usage: 769,
				this_hour_searches: 12,
				plan_monthly_price: 75,
			});

		const health = await fetchSerpApiAccount("secret-key", {
			fetch: fakeFetch as unknown as typeof fetch,
			now: () => new Date("2026-04-07T08:12:00.000Z"),
		});

		expect(health.status).toBe("ok");
		expect(health.searches_left).toBe(4231);
		expect(health.plan_searches_left).toBe(4231);
		expect(health.plan_monthly_price).toBe(75);
		expect(health.last_hour_searches).toBe(12);
		expect(health.plan).toBe("developer");
		expect(health.checked_at).toBe("2026-04-07T08:12:00.000Z");
		expect(health.error).toBeUndefined();
	});

	it("returns status: warning when total_searches_left is between 100 and 500", async () => {
		const fakeFetch = async () =>
			okResponse({
				plan_id: "developer",
				plan_searches_left: 499,
				total_searches_left: 499,
				plan_monthly_price: 75,
				this_hour_searches: 3,
			});

		const health = await fetchSerpApiAccount("k", {
			fetch: fakeFetch as unknown as typeof fetch,
		});

		expect(health.status).toBe("warning");
		expect(health.searches_left).toBe(499);
	});

	it("returns status: critical when total_searches_left < 100", async () => {
		const fakeFetch = async () =>
			okResponse({
				plan_id: "developer",
				plan_searches_left: 42,
				total_searches_left: 42,
			});

		const health = await fetchSerpApiAccount("k", {
			fetch: fakeFetch as unknown as typeof fetch,
		});

		expect(health.status).toBe("critical");
		expect(health.searches_left).toBe(42);
	});

	it("returns status: error when SerpAPI returns non-200", async () => {
		const fakeFetch = async () =>
			new Response(JSON.stringify({ error: "Invalid API key." }), {
				status: 401,
				headers: { "Content-Type": "application/json" },
			});

		const health = await fetchSerpApiAccount("bad-key", {
			fetch: fakeFetch as unknown as typeof fetch,
		});

		expect(health.status).toBe("error");
		expect(health.searches_left).toBeNull();
		expect(health.error).toBeDefined();
		expect(health.error).toContain("401");
	});

	it("returns status: error when fetch throws (network failure)", async () => {
		const fakeFetch = async () => {
			throw new Error("getaddrinfo ENOTFOUND serpapi.com");
		};

		const health = await fetchSerpApiAccount("k", {
			fetch: fakeFetch as unknown as typeof fetch,
		});

		expect(health.status).toBe("error");
		expect(health.error).toContain("ENOTFOUND");
		expect(health.searches_left).toBeNull();
	});

	it("returns status: error when fetch is aborted by timeout", async () => {
		// Fake fetch that respects AbortSignal and hangs otherwise
		const fakeFetch = (
			_url: string | URL | Request,
			init?: RequestInit,
		): Promise<Response> => {
			return new Promise((_resolve, reject) => {
				const signal = init?.signal;
				if (signal?.aborted) {
					reject(new DOMException("Aborted", "AbortError"));
					return;
				}
				signal?.addEventListener("abort", () => {
					reject(new DOMException("Aborted", "AbortError"));
				});
			});
		};

		const health = await fetchSerpApiAccount("k", {
			fetch: fakeFetch as unknown as typeof fetch,
			timeoutMs: 50,
		});

		expect(health.status).toBe("error");
		expect(health.error).toBeDefined();
	});

	it("never leaks api_key into the result, even on error", async () => {
		const SECRET = "sk_super_secret_12345";

		// Happy path
		const okFetch = async () =>
			okResponse({
				plan_id: "dev",
				total_searches_left: 1000,
				plan_searches_left: 1000,
			});
		const okHealth = await fetchSerpApiAccount(SECRET, {
			fetch: okFetch as unknown as typeof fetch,
		});
		expect(JSON.stringify(okHealth)).not.toContain(SECRET);

		// HTTP error path — message might include URL
		const httpErrFetch = async () => new Response("nope", { status: 403 });
		const httpErrHealth = await fetchSerpApiAccount(SECRET, {
			fetch: httpErrFetch as unknown as typeof fetch,
		});
		expect(JSON.stringify(httpErrHealth)).not.toContain(SECRET);

		// Network throw path — error message from inner Error could contain URL
		const throwFetch = async () => {
			throw new Error(
				`connect ECONNREFUSED https://serpapi.com/account.json?api_key=${SECRET}`,
			);
		};
		const throwHealth = await fetchSerpApiAccount(SECRET, {
			fetch: throwFetch as unknown as typeof fetch,
		});
		expect(JSON.stringify(throwHealth)).not.toContain(SECRET);
	});
});

function createMapCache(): CachePort {
	const store = new Map<string, AccountHealth>();
	return {
		async get(key) {
			return store.get(key) ?? null;
		},
		async set(key, value) {
			store.set(key, value);
		},
	};
}

describe("getCachedAccountHealth", () => {
	it("calls fetch only once within the cache TTL", async () => {
		const fetchMock = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						plan_id: "developer",
						plan_searches_left: 1000,
						total_searches_left: 1000,
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
		);

		const cache = createMapCache();
		const deps = {
			fetch: fetchMock as unknown as typeof fetch,
			cache,
			now: () => new Date("2026-04-07T08:00:00.000Z"),
		};

		const first = await getCachedAccountHealth("k", deps);
		const second = await getCachedAccountHealth("k", deps);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(first.searches_left).toBe(1000);
		expect(second.searches_left).toBe(1000);
		expect(second.checked_at).toBe(first.checked_at); // served from cache
	});

	it("does NOT cache error responses", async () => {
		const fetchMock = vi.fn(async () => new Response("boom", { status: 500 }));
		const cache = createMapCache();
		const deps = {
			fetch: fetchMock as unknown as typeof fetch,
			cache,
		};

		await getCachedAccountHealth("k", deps);
		await getCachedAccountHealth("k", deps);

		// both calls must hit fetch — we don't want to freeze an error state
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});
