import { describe, expect, it } from "vitest";
import source from "./[slug].astro?raw";

// Issue #72/#81: the public HTML route runs inside Astro's SSR pipeline, which
// the worker test harness mocks out (@astrojs/cloudflare/handler is stubbed), so
// the frontmatter can't be invoked directly. The gate decision itself lives in
// the behaviorally-tested isPubliclyServable() (see site-status.test.ts, which
// covers the null/undefined case) and the cache value in publicCacheControl()
// (see public-page.test.ts); these assertions verify the route wires both in.
// The biz-null → 410 behaviour is covered end-to-end on the sibling .md route in
// [slug].md.test.ts.
describe("[slug].astro publish gate wiring", () => {
	it("adds site_status to the business SELECT so the gate has data", () => {
		expect(source).toContain("b.operating_hours, b.site_status");
	});

	it("withholds a non-done OR null-join business with a 410", () => {
		// biz?.site_status so a null D1 join (stale R2 key after a slug change)
		// falls through to isPubliclyServable(undefined) === false → 410, instead
		// of rendering a self-canonical noindex 200.
		expect(source).toContain("isPubliclyServable(biz?.site_status)");
		expect(source).toMatch(/status:\s*410/);
	});

	it("indexes every served public page — no 200 can carry noindex", () => {
		// Reaching render on the non-draft path means the gate already passed, so
		// indexability depends only on draft-ness, never on biz being non-null.
		expect(source).toContain("isIndexable={!isDraft}");
		expect(source).not.toContain("!!biz");
	});

	it("serves the public page with the short-lived cache header", () => {
		expect(source).toContain("publicCacheControl");
		expect(source).not.toContain("max-age=86400");
	});
});
