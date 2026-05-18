import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb } from "../../../../test/seed";
import { type AccountHealth, CACHE_KEY } from "../../../lib/serpapi/account";

const cfCache = (caches as unknown as { default: Cache }).default;

beforeEach(async () => {
	await resetDb(env.leadgen);
	// Cache API persists across tests in the same worker — flush it.
	await cfCache.delete(new Request(`https://cache.internal/${CACHE_KEY}`));
});
afterEach(() => vi.unstubAllGlobals());

async function callEndpoint(token?: string) {
	const { GET } = await import("./serpapi");
	const url = "http://localhost/api/health/serpapi";
	const headers: Record<string, string> = {};
	if (token) headers["x-seller-token"] = token;
	return GET({
		request: new Request(url, { headers }),
		locals: { runtime: { env } },
	} as unknown as Parameters<typeof GET>[0]);
}

describe("GET /api/health/serpapi", () => {
	it("returns 401 without seller token", async () => {
		const res = await callEndpoint();
		expect(res.status).toBe(401);
	});

	it("returns 401 with invalid seller token", async () => {
		const res = await callEndpoint("bogus-token");
		expect(res.status).toBe(401);
	});

	it("returns 200 with SerpAPI snapshot when authorized", async () => {
		const fetchMock = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						plan_id: "developer",
						plan_searches_left: 4231,
						total_searches_left: 4231,
						plan_monthly_price: 75,
						this_hour_searches: 12,
					}),
					{
						status: 200,
						headers: { "Content-Type": "application/json" },
					},
				),
		);
		vi.stubGlobal("fetch", fetchMock);

		const res = await callEndpoint("seller_jan_token");
		expect(res.status).toBe(200);

		const body = (await res.json()) as AccountHealth;
		expect(body.status).toBe("ok");
		expect(body.searches_left).toBe(4231);
		expect(body.plan).toBe("developer");
		expect(body.plan_monthly_price).toBe(75);
		expect(body.last_hour_searches).toBe(12);
		expect(typeof body.checked_at).toBe("string");

		// fetch called with SerpAPI URL
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const firstCall = fetchMock.mock.calls[0] as unknown as [
			string | URL | Request,
		];
		expect(String(firstCall[0])).toContain("serpapi.com/account.json");
	});

	it("second call within TTL reuses cached SerpAPI response", async () => {
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
		vi.stubGlobal("fetch", fetchMock);

		const first = await callEndpoint("seller_jan_token");
		const second = await callEndpoint("seller_jan_token");

		expect(first.status).toBe(200);
		expect(second.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
