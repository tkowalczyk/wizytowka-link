import { describe, expect, it } from "vitest";
import { canonicalFor } from "../lib/indexability";
import source from "./index.astro?raw";

// Issue #84: the landing page's canonical + robots had no test. The homepage is
// unconditionally indexable (no per-page decision to extract), but its canonical
// must resolve to the bare https apex — a trailing slash or http scheme here is
// the same "Page with redirect" / canonical-drift class as #81. The canonical
// value is covered behaviorally via canonicalFor; a source guard locks the page
// to that helper and to an indexable homepage.
describe("landing page robots + canonical", () => {
	it("canonical resolves to the bare https apex (no trailing slash)", () => {
		expect(canonicalFor("/")).toBe("https://wizytowka.link");
	});

	it("routes its canonical through canonicalFor and marks the homepage indexable", () => {
		expect(source).toContain('canonicalFor("/")');
		expect(source).toContain('content="index, follow"');
	});
});
