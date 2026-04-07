import { describe, expect, it } from "vitest";
import { buildCategoryUrls } from "./sitemap.xml";

const DOMAIN = "https://wizytowka.link";

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
