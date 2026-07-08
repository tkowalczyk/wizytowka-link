import { describe, expect, it } from "vitest";
import source from "./[slug].astro?raw";

// Issue #72: the public HTML route runs inside Astro's SSR pipeline, which the
// worker test harness mocks out (@astrojs/cloudflare/handler is stubbed), so the
// frontmatter can't be invoked directly. The gate decision itself lives in the
// behaviorally-tested isPubliclyServable() (see site-status.test.ts) and the
// cache value in publicCacheControl() (see public-page.test.ts); these
// assertions verify the route wires both in. The .md sibling route is covered
// end-to-end in [slug].md.test.ts.
describe("[slug].astro publish gate wiring", () => {
	it("adds site_status to the business SELECT so the gate has data", () => {
		expect(source).toContain("b.operating_hours, b.site_status");
	});

	it("withholds non-done businesses with a 410 via isPubliclyServable", () => {
		expect(source).toContain("isPubliclyServable(biz.site_status)");
		expect(source).toMatch(/status:\s*410/);
	});

	it("serves the public page with the short-lived cache header", () => {
		expect(source).toContain("publicCacheControl");
		expect(source).not.toContain("max-age=86400");
	});
});
