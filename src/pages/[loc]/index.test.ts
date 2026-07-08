import { describe, expect, it } from "vitest";
import source from "./index.astro?raw";

describe("locality index category navigation", () => {
	// Issue #71: category pages were orphans — findLocalityCategories had zero
	// production callers and no page emitted a /kategoria/ href, so those pages
	// were reachable only from the sitemap. The locality index must surface
	// category navigation so the pages accrue internal links.
	it("uses findLocalityCategories to render links to category pages", () => {
		expect(source).toContain("findLocalityCategories");
		expect(source).toContain("/kategoria/");
	});
});
