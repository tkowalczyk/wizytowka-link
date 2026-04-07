import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../test/seed";
import {
	type GeocoderDeps,
	type GeoResult,
	geocodeLocalities,
} from "./geocoder";

function successGeo(overrides: Partial<GeoResult> = {}): GeoResult {
	return {
		lat: 50.06,
		lon: 19.94,
		nominatim_place_id: 1,
		osm_type: "node",
		osm_id: 100,
		nominatim_type: "city",
		place_rank: 16,
		address_type: "city",
		bbox: "[]",
		...overrides,
	};
}

function makeDeps(overrides: Partial<GeocoderDeps> = {}): GeocoderDeps {
	return {
		db: env.leadgen,
		geocode: async () => successGeo(),
		sleepMs: 0,
		wallTimeLimitMs: 60_000,
		batchSize: 300,
		...overrides,
	};
}

beforeEach(() => resetDb(env.leadgen));

describe("geocodeLocalities", () => {
	it("queries localities where geocode_retry_after is null or past", async () => {
		// Nowa Wieś (id=4) has lat=NULL — should be picked up
		const geocoded: number[] = [];
		const deps = makeDeps({
			geocode: async (loc) => {
				geocoded.push(loc.id);
				return successGeo();
			},
		});

		await geocodeLocalities(deps);

		expect(geocoded).toContain(4);
	});

	it("skips localities with future geocode_retry_after", async () => {
		await env.leadgen
			.prepare(
				"UPDATE localities SET geocode_retry_after = datetime('now', '+1 day') WHERE id = 4",
			)
			.run();

		const geocoded: number[] = [];
		const deps = makeDeps({
			geocode: async (loc) => {
				geocoded.push(loc.id);
				return successGeo();
			},
		});

		await geocodeLocalities(deps);

		expect(geocoded).not.toContain(4);
	});

	it("picks up localities with past geocode_retry_after", async () => {
		await env.leadgen
			.prepare(
				"UPDATE localities SET geocode_retry_after = datetime('now', '-1 hour') WHERE id = 4",
			)
			.run();

		const geocoded: number[] = [];
		const deps = makeDeps({
			geocode: async (loc) => {
				geocoded.push(loc.id);
				return successGeo();
			},
		});

		await geocodeLocalities(deps);

		expect(geocoded).toContain(4);
	});

	it("on failure sets geocode_retry_after with exponential backoff", async () => {
		let _callCount = 0;
		const deps = makeDeps({
			geocode: async () => {
				_callCount++;
				return null; // not found
			},
		});

		await geocodeLocalities(deps);

		const row = await env.leadgen
			.prepare("SELECT geocode_retry_after FROM localities WHERE id = 4")
			.first<{ geocode_retry_after: string }>();

		expect(row?.geocode_retry_after).toBeTruthy();
		// first failure → 1 hour backoff
		const retryAt = new Date(`${row?.geocode_retry_after}Z`);
		const now = new Date();
		const diffHours = (retryAt.getTime() - now.getTime()) / (1000 * 60 * 60);
		expect(diffHours).toBeGreaterThan(0.5);
		expect(diffHours).toBeLessThan(1.5);
	});

	it("increases backoff on repeated failures", async () => {
		// Simulate a locality that already failed once (retry_after in past, fail_count=1)
		await env.leadgen
			.prepare(
				"UPDATE localities SET geocode_retry_after = datetime('now', '-1 minute'), geocode_fail_count = 1 WHERE id = 4",
			)
			.run();

		const deps = makeDeps({
			geocode: async () => null,
		});

		await geocodeLocalities(deps);

		const row = await env.leadgen
			.prepare(
				"SELECT geocode_retry_after, geocode_fail_count FROM localities WHERE id = 4",
			)
			.first<{ geocode_retry_after: string; geocode_fail_count: number }>();

		expect(row?.geocode_fail_count).toBe(2);
		// 2nd failure → 2 hour backoff
		const retryAt = new Date(`${row?.geocode_retry_after}Z`);
		const now = new Date();
		const diffHours = (retryAt.getTime() - now.getTime()) / (1000 * 60 * 60);
		expect(diffHours).toBeGreaterThan(1.5);
		expect(diffHours).toBeLessThan(2.5);
	});

	it("respects geocode_failed=1 as manual skip", async () => {
		await env.leadgen
			.prepare(
				"UPDATE localities SET lat = NULL, geocode_failed = 1 WHERE id = 4",
			)
			.run();

		const geocoded: number[] = [];
		const deps = makeDeps({
			geocode: async (loc) => {
				geocoded.push(loc.id);
				return successGeo();
			},
		});

		await geocodeLocalities(deps);

		expect(geocoded).not.toContain(4);
	});

	it("returns RunResult with processed and failed counts", async () => {
		// id=4 has lat=NULL, others have lat set
		const deps = makeDeps({
			geocode: async () => successGeo(),
		});

		const result = await geocodeLocalities(deps);

		expect(result.processed).toBe(1);
		expect(result.failed).toBe(0);
	});

	it("counts failures in RunResult", async () => {
		const deps = makeDeps({
			geocode: async () => null,
		});

		const result = await geocodeLocalities(deps);

		expect(result.processed).toBe(0);
		expect(result.failed).toBe(1);
	});
});
