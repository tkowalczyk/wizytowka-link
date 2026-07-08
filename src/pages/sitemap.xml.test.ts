import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
			today: "2026-07-08",
			staticPages: [{ loc: "/", priority: "1.0" }],
			localities: fakeLocalities(2000),
			businesses: fakeBusinesses(49_000),
			categoryRows: fakeCategoryPairs(500),
		});

		expect(urls).toHaveLength(50_000);
	});
});

const getHomepageLastmod = (xml: string) => {
	const match = xml.match(
		/<loc>https:\/\/wizytowka\.link\/<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/,
	);
	if (!match) throw new Error("Expected homepage sitemap entry with lastmod");
	return match[1];
};

describe("GET sitemap.xml", () => {
	beforeEach(async () => {
		await resetDb(env.leadgen);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("stamps static lastmod at request time", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-07-08T12:00:00.000Z"));

		const firstResponse = await GET({} as Parameters<typeof GET>[0]);
		const firstXml = await firstResponse.text();

		vi.setSystemTime(new Date("2026-07-10T12:00:00.000Z"));

		const secondResponse = await GET({} as Parameters<typeof GET>[0]);
		const secondXml = await secondResponse.text();

		expect(getHomepageLastmod(firstXml)).toBe("2026-07-08");
		expect(getHomepageLastmod(secondXml)).toBe("2026-07-10");
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
