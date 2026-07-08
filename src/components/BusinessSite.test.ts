import { describe, expect, it } from "vitest";
import source from "./BusinessSite.astro?raw";

describe("BusinessSite presentation overrides", () => {
	it("honors layout/style overrides baked into the site JSON", () => {
		expect(source).toMatch(/site\.layout/);
		expect(source).toMatch(/site\.style/);
	});

	it("validates the baked layout/style before use, falling back to the hash theme", () => {
		expect(source).toMatch(
			/isLayoutVariant\(site\.layout\)\s*\?\s*site\.layout\s*:\s*resolved\.layout/,
		);
		expect(source).toMatch(
			/isStyleVariant\(site\.style\)\s*\?\s*site\.style\s*:\s*resolved\.style/,
		);
	});
});
