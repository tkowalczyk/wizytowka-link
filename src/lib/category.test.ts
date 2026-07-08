import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../test/seed";
import { findCategoryBusinesses, findLocalityCategories } from "./category";

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
		// seed: warszawa has hydraulik (4.5) and fryzjer (4.8), both site_status='done'
		// Insert a second hydraulik with lower rating to test ordering
		await env.leadgen
			.prepare(
				"INSERT INTO businesses (locality_id, place_id, title, slug, category, rating, gps_lat, gps_lng, site_status) VALUES (2, 'place_zzz', 'Hydraulik Pomocnik', 'hydraulik-pomocnik', 'hydraulik', 3.0, 52.23, 21.01, 'done')",
			)
			.run();

		const result = await findCategoryBusinesses(
			env.leadgen,
			"warszawa",
			"hydraulik",
		);

		expect(result).not.toBeNull();
		if (!result) throw new Error("Expected category result");
		expect(result.locality.slug).toBe("warszawa");
		expect(result.categoryName).toBe("hydraulik");
		expect(result.businesses).toHaveLength(2);
		expect(result.businesses[0].rating).toBe(4.5);
		expect(result.businesses[1].rating).toBe(3.0);
	});

	it("lists businesses from all raw categories sharing a slug", async () => {
		await env.leadgen
			.prepare(
				"INSERT INTO businesses (locality_id, place_id, title, slug, category, rating, gps_lat, gps_lng, site_status) VALUES (2, 'place_collision_1', 'Fryzjer Męski Centrum', 'fryzjer-meski-centrum', 'Fryzjer Męski', 4.1, 52.23, 21.01, 'done')",
			)
			.run();
		await env.leadgen
			.prepare(
				"INSERT INTO businesses (locality_id, place_id, title, slug, category, rating, gps_lat, gps_lng, site_status) VALUES (2, 'place_collision_2', 'Fryzjer Meski Praga', 'fryzjer-meski-praga', 'Fryzjer Meski', 4.7, 52.24, 21.02, 'done')",
			)
			.run();

		const result = await findCategoryBusinesses(
			env.leadgen,
			"warszawa",
			"fryzjer-meski",
		);

		expect(result).not.toBeNull();
		if (!result) throw new Error("Expected category result");
		expect(result.categoryName).toBe("Fryzjer Meski");
		expect(result.businesses.map((business) => business.title)).toEqual([
			"Fryzjer Meski Praga",
			"Fryzjer Męski Centrum",
		]);
	});

	it("excludes businesses with site_status != 'done'", async () => {
		// krakow has 'dentysta' with site_status='pending' and 'piekarnia' with site_status='done'
		// 'dentysta' should not match any category slug
		const result = await findCategoryBusinesses(
			env.leadgen,
			"krakow",
			"dentysta",
		);
		expect(result).toBeNull();
	});
});

describe("findLocalityCategories", () => {
	it("returns empty array when locality does not exist", async () => {
		const result = await findLocalityCategories(env.leadgen, "nieistniejaca");
		expect(result).toEqual([]);
	});

	it("returns categories with correct counts (only site_status='done')", async () => {
		// warszawa: hydraulik(done), fryzjer(done), sklep(ineligible) → 2 categories
		const result = await findLocalityCategories(env.leadgen, "warszawa");
		expect(result).toHaveLength(2);
		const names = result.map((c) => c.categoryName).sort();
		expect(names).toEqual(["fryzjer", "hydraulik"]);
	});

	it("returns count=1 for single-firm category", async () => {
		// krakow: piekarnia(done) only
		const result = await findLocalityCategories(env.leadgen, "krakow");
		expect(result).toHaveLength(1);
		expect(result[0].count).toBe(1);
	});

	it("returns correct slug for each category", async () => {
		const result = await findLocalityCategories(env.leadgen, "warszawa");
		for (const cat of result) {
			expect(cat.slug).toBe(cat.categoryName.toLowerCase());
		}
	});

	it("returns empty array for locality with no generated businesses", async () => {
		// wroclaw: mechanik(site_status='pending')
		const result = await findLocalityCategories(env.leadgen, "wroclaw");
		expect(result).toEqual([]);
	});

	it("surfaces slugs that resolve to non-empty category pages (issue #71 no-orphan contract)", async () => {
		// The locality index renders one link per category using cat.slug.
		// Each of those hrefs must resolve back through findCategoryBusinesses to
		// a real, non-empty category page — otherwise the links are orphans again.
		// Guards against slug drift between the link builder and the route lookup.
		const categories = await findLocalityCategories(env.leadgen, "warszawa");
		expect(categories.length).toBeGreaterThan(0);

		for (const cat of categories) {
			const page = await findCategoryBusinesses(
				env.leadgen,
				"warszawa",
				cat.slug,
			);
			expect(page).not.toBeNull();
			expect(page?.businesses.length).toBeGreaterThan(0);
		}
	});
});
