import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../test/seed";
import { assembleSitemapUrls, buildCategoryUrls, GET } from "./sitemap.xml";

const DOMAIN = "https://wizytowka.link";

// Assumptions for issue #69:
// - assembleSitemapUrls is the public pure interface for sitemap assembly tests.
// - It returns XML entry strings and never more than the sitemaps.org 50,000 URL cap.
// - Static pages, localities, and category pages are prioritized before business pages.
// - Sitemap-index pagination is intentionally not covered in this iteration.
const fakeLocalities = (count: number) =>
	Array.from({ length: count }, (_, i) => ({ slug: `miasto-${i}` }));

const fakeBusinesses = (count: number) =>
	Array.from({ length: count }, (_, i) => ({
		slug: `firma-${i}`,
		loc_slug: `miasto-${i % 2000}`,
		created_at: "2026-07-01 12:00:00",
	}));

const fakeCategoryPairs = (count: number) =>
	Array.from({ length: count }, (_, i) => ({
		loc_slug: `miasto-${i % 2000}`,
		category: `Kategoria ${i}`,
	}));

describe("assembleSitemapUrls", () => {
	it("never assembles more than 50,000 URLs", () => {
		const urls = assembleSitemapUrls({
			domain: DOMAIN,
			staticPages: [{ loc: "/", changefreq: "weekly", priority: "1.0" }],
			localities: fakeLocalities(2000),
			businesses: fakeBusinesses(49_000),
			categoryRows: fakeCategoryPairs(500),
		});

		expect(urls).toHaveLength(50_000);
	});
});

describe("GET sitemap.xml", () => {
	beforeEach(async () => {
		await resetDb(env.leadgen);
	});

	it("submits every indexable static page", async () => {
		const response = await GET({} as Parameters<typeof GET>[0]);
		const xml = await response.text();

		expect(xml).toContain("<loc>https://wizytowka.link/</loc>");
		expect(xml).toContain("<loc>https://wizytowka.link/regulamin</loc>");
		expect(xml).toContain(
			"<loc>https://wizytowka.link/polityka-prywatnosci</loc>",
		);
	});

	it("does not claim a changing lastmod date for unchanged static pages", async () => {
		const response = await GET({} as Parameters<typeof GET>[0]);
		const xml = await response.text();
		const homepageEntry = xml.match(
			/<url>\s*<loc>https:\/\/wizytowka\.link\/<\/loc>[\s\S]*?<\/url>/,
		)?.[0];

		expect(homepageEntry).toBeDefined();
		expect(homepageEntry).not.toContain("<lastmod>");
	});
});

describe("buildCategoryUrls", () => {
	it("returns empty array for empty input", () => {
		expect(buildCategoryUrls([], DOMAIN)).toEqual([]);
	});

	it("generates correct URL for a single category", () => {
		const result = buildCategoryUrls(
			[{ loc_slug: "warszawa", category: "hydraulik" }],
			DOMAIN,
		);
		expect(result).toHaveLength(1);
		expect(result[0]).toContain(`${DOMAIN}/warszawa/kategoria/hydraulik`);
	});

	it("deduplicates same loc+category pair (different raw strings, same slug)", () => {
		const result = buildCategoryUrls(
			[
				{ loc_slug: "warszawa", category: "Hydraulik" },
				{ loc_slug: "warszawa", category: "Hydraulik" },
			],
			DOMAIN,
		);
		expect(result).toHaveLength(1);
	});

	it("does not deduplicate same category in different localities", () => {
		const result = buildCategoryUrls(
			[
				{ loc_slug: "warszawa", category: "hydraulik" },
				{ loc_slug: "krakow", category: "hydraulik" },
			],
			DOMAIN,
		);
		expect(result).toHaveLength(2);
	});

	it("sets priority 0.6", () => {
		const result = buildCategoryUrls(
			[{ loc_slug: "warszawa", category: "fryzjer" }],
			DOMAIN,
		);
		expect(result[0]).toContain("<priority>0.6</priority>");
	});

	it("slugifies Polish category names", () => {
		const result = buildCategoryUrls(
			[{ loc_slug: "zabki", category: "Usługi hydrauliczne" }],
			DOMAIN,
		);
		expect(result[0]).toContain(
			`${DOMAIN}/zabki/kategoria/uslugi-hydrauliczne`,
		);
	});
});
