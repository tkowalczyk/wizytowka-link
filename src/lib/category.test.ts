import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../test/seed";
import { findCategoryBusinesses } from "./category";

beforeEach(() => resetDb(env.leadgen));

describe("findCategoryBusinesses", () => {
	it("returns null when locality does not exist", async () => {
		const result = await findCategoryBusinesses(
			env.leadgen,
			"nieistniejaca",
			"hydraulik",
		);
		expect(result).toBeNull();
	});

	it("returns null when category slug has no match", async () => {
		const result = await findCategoryBusinesses(
			env.leadgen,
			"warszawa",
			"nieistniejaca-kategoria",
		);
		expect(result).toBeNull();
	});

	it("returns locality, categoryName and businesses sorted by rating DESC", async () => {
		// seed: warszawa has hydraulik (4.5) and fryzjer (4.8), both site_generated=1
		// Insert a second hydraulik with lower rating to test ordering
		await env.leadgen
			.prepare(
				"INSERT INTO businesses (locality_id, place_id, title, slug, category, rating, gps_lat, gps_lng, site_generated) VALUES (2, 'place_zzz', 'Hydraulik Pomocnik', 'hydraulik-pomocnik', 'hydraulik', 3.0, 52.23, 21.01, 1)",
			)
			.run();

		const result = await findCategoryBusinesses(
			env.leadgen,
			"warszawa",
			"hydraulik",
		);

		expect(result).not.toBeNull();
		expect(result!.locality.slug).toBe("warszawa");
		expect(result!.categoryName).toBe("hydraulik");
		expect(result!.businesses).toHaveLength(2);
		expect(result!.businesses[0].rating).toBe(4.5);
		expect(result!.businesses[1].rating).toBe(3.0);
	});

	it("excludes businesses with site_generated = 0", async () => {
		// krakow has 'dentysta' with site_generated=0 and 'piekarnia' with site_generated=1
		// 'dentysta' should not match any category slug
		const result = await findCategoryBusinesses(
			env.leadgen,
			"krakow",
			"dentysta",
		);
		expect(result).toBeNull();
	});
});
