import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../../test/seed";
import { robotsForListing } from "../../lib/indexability";
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

// Issue #84: the empty-locality `noindex, follow` branch (index.astro) was
// untested. The robots DECISION is covered behaviorally through the real
// count-of-done-businesses query feeding robotsForListing; a source guard locks
// the page to the shared helpers so the decision can't be re-hardcoded or drift
// from the category page.
describe("locality index robots", () => {
	beforeEach(async () => {
		await resetDb(env.leadgen);
	});

	const doneCount = async (locSlug: string): Promise<number> => {
		const row = await env.leadgen
			.prepare(
				"SELECT COUNT(*) AS n FROM businesses b JOIN localities l ON b.locality_id = l.id WHERE l.slug = ? AND b.site_status = 'done'",
			)
			.bind(locSlug)
			.first<{ n: number }>();
		return row?.n ?? 0;
	};

	it("indexes a locality with at least one done business", async () => {
		// warszawa: hydraulik + fryzjer are both done (seed).
		const count = await doneCount("warszawa");
		expect(count).toBeGreaterThan(0);
		expect(robotsForListing(count)).toBe("index, follow");
	});

	it("noindexes a locality whose businesses are all non-done", async () => {
		// wroclaw: its only business (mechanik) is 'pending' → zero done.
		const count = await doneCount("wroclaw");
		expect(count).toBe(0);
		expect(robotsForListing(count)).toBe("noindex, follow");
	});

	it("noindexes a locality with no businesses at all", async () => {
		// nowa-wies has no businesses seeded.
		const count = await doneCount("nowa-wies");
		expect(count).toBe(0);
		expect(robotsForListing(count)).toBe("noindex, follow");
	});

	it("wires robots + canonical through the shared helpers (no hard-coded values)", () => {
		expect(source).toContain("robotsForListing(businesses.length)");
		expect(source).toContain("canonicalFor(");
	});
});
