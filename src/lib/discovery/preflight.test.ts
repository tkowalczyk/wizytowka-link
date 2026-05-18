import { describe, expect, it } from "vitest";
import type { AccountHealth } from "../serpapi/account";
import type { StatePort } from "./ports";
import {
	preflightDiscovery,
	SKIP_FLAG_KEY,
	SKIP_TTL_SECONDS,
} from "./preflight";

// -- helpers --

function fakeState(initial: Record<string, string> = {}) {
	const store = new Map<string, string>(Object.entries(initial));
	const ttls = new Map<string, number | undefined>();
	const port: StatePort = {
		async get(key) {
			return store.get(key) ?? null;
		},
		async put(key, value, opts) {
			store.set(key, value);
			ttls.set(key, opts?.ttlSeconds);
		},
		async delete(key) {
			store.delete(key);
			ttls.delete(key);
		},
	};
	return { port, store, ttls };
}

function fakeAccount(overrides: Partial<AccountHealth> = {}): AccountHealth {
	return {
		plan: "developer",
		searches_left: 5000,
		plan_searches_left: 5000,
		plan_monthly_price: 75,
		last_hour_searches: 0,
		status: "ok",
		checked_at: "2026-04-07T07:55:00.000Z",
		...overrides,
	};
}

describe("preflightDiscovery", () => {
	it("account fetch fails → does NOT set skip (fail open)", async () => {
		const { port, store } = fakeState();
		const result = await preflightDiscovery({
			fetchAccount: async () =>
				fakeAccount({
					status: "error",
					searches_left: null,
					error: "SerpAPI HTTP 500",
				}),
			state: port,
			threshold: 200,
		});

		expect(store.has(SKIP_FLAG_KEY)).toBe(false);
		expect(result.meta.skip).toBe(false);
		expect(result.meta.searchesLeft).toBeNull();
		expect(result.meta.reason).toBe("fetch-failed");
	});

	it("searches_left below threshold → sets skip flag in KV with TTL", async () => {
		const { port, store, ttls } = fakeState();
		const result = await preflightDiscovery({
			fetchAccount: async () => fakeAccount({ searches_left: 50 }),
			state: port,
			threshold: 200,
		});

		expect(store.has(SKIP_FLAG_KEY)).toBe(true);
		expect(ttls.get(SKIP_FLAG_KEY)).toBe(SKIP_TTL_SECONDS);
		expect(result.meta.skip).toBe(true);
		expect(result.meta.searchesLeft).toBe(50);
		expect(result.meta.threshold).toBe(200);

		// payload contains searchesLeft so discovery can use it
		const storedPayload = store.get(SKIP_FLAG_KEY);
		if (!storedPayload) throw new Error("Expected skip flag payload");
		const payload = JSON.parse(storedPayload) as {
			searchesLeft: number;
		};
		expect(payload.searchesLeft).toBe(50);
	});

	it("searches_left above threshold → no skip flag set", async () => {
		const { port, store } = fakeState();
		const result = await preflightDiscovery({
			fetchAccount: async () => fakeAccount({ searches_left: 1000 }),
			state: port,
			threshold: 200,
		});

		expect(store.has(SKIP_FLAG_KEY)).toBe(false);
		expect(result.meta.skip).toBe(false);
		expect(result.meta.searchesLeft).toBe(1000);
		expect(result.meta.threshold).toBe(200);
		expect(result.processed).toBe(0);
		expect(result.failed).toBe(0);
	});
});
