import { describe, expect, it } from "vitest";
import centered from "./CenteredLayout.astro?raw";
import minimal from "./MinimalLayout.astro?raw";
import split from "./SplitLayout.astro?raw";

const layouts = [
	["CenteredLayout", centered],
	["SplitLayout", split],
	["MinimalLayout", minimal],
] as const;

describe("business page layout category backlink", () => {
	// Issue #71: business pages were dead-ends toward their category page — no
	// layout linked back to /[loc]/kategoria/[category]. Every layout must emit a
	// backlink so the category pages accrue internal links from every business,
	// and the href must slugify the raw category so it resolves to the route.
	for (const [name, source] of layouts) {
		it(`${name} links back to the category page`, () => {
			expect(source).toContain("/kategoria/");
			expect(source).toContain("slugify(category)");
		});
	}
});
