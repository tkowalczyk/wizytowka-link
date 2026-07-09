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

// Issue #84: the robots + canonical decision (indexable → `index, follow`;
// withheld → `noindex, nofollow`; canonical = https apex, no trailing slash) had
// no behavioral test — the #81 blind spot. The decision itself is covered in
// src/lib/indexability.test.ts (robotsForBusiness / canonicalFor); here we guard
// that the page delegates to those helpers instead of re-inlining the strings.
describe("BusinessSite robots + canonical wiring", () => {
	it("derives robots from robotsForBusiness(isIndexable)", () => {
		expect(source).toContain("robotsForBusiness(isIndexable)");
		expect(source).not.toContain("'index, follow'");
	});

	it("derives the canonical URL from canonicalFor(Astro.url.pathname)", () => {
		expect(source).toContain("canonicalFor(Astro.url.pathname)");
	});
});
