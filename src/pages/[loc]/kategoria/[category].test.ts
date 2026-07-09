import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../../../test/seed";
import { findCategoryBusinesses } from "../../../lib/category";
import { robotsForListing } from "../../../lib/indexability";
import categorySource from "./[category].astro?raw";

// Issue #84: [category].astro:53 hard-coded `index, follow` regardless of how
// many businesses the category lists — the same untested robots blind spot that
// let the #81 "200 + noindex" defect ship. The page's robots meta must derive
// from the listed-business count, mirroring the locality index.
//
// Astro SSR frontmatter can't run in the workers pool, so the robots DECISION
// is covered behaviorally through the real D1 query feeding robotsForListing;
// a source guard locks the page to that helper so `index, follow` can never be
// re-hardcoded.
describe("category page robots", () => {
	beforeEach(async () => {
		await resetDb(env.leadgen);
	});

	it("indexes a category that lists at least one done business", async () => {
		// warszawa has one done 'hydraulik' business (seed).
		const data = await findCategoryBusinesses(
			env.leadgen,
			"warszawa",
			"hydraulik",
		);

		expect(data?.businesses.length).toBeGreaterThan(0);
		expect(robotsForListing(data?.businesses.length ?? 0)).toBe(
			"index, follow",
		);
	});

	it("emits noindex, follow for an empty category listing", () => {
		// A category with zero listed businesses is a thin page; the fix makes the
		// page emit noindex, follow instead of the old hard-coded index, follow.
		expect(robotsForListing(0)).toBe("noindex, follow");
	});

	it("wires robots + canonical through the shared helpers (no hard-coded values)", () => {
		expect(categorySource).toContain("robotsForListing(businesses.length)");
		expect(categorySource).toContain("canonicalFor(");
		expect(categorySource).not.toContain('content="index, follow"');
	});
});
