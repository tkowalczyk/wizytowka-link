import { describe, expect, it } from "vitest";
import {
	canonicalFor,
	robotsForBusiness,
	robotsForListing,
} from "./indexability";

// Issue #84: robots decisions were copy-pasted across page types and untested —
// the blind spot that let the #81 "200 + noindex" defect ship. These helpers
// are the single behavioral spec for every robots/canonical decision.

describe("robotsForListing", () => {
	it("noindexes an empty listing to avoid thin / soft-404 pages", () => {
		expect(robotsForListing(0)).toBe("noindex, follow");
	});

	it("indexes a listing that has at least one business", () => {
		expect(robotsForListing(1)).toBe("index, follow");
		expect(robotsForListing(12)).toBe("index, follow");
	});
});

describe("robotsForBusiness", () => {
	it("indexes a servable business page", () => {
		expect(robotsForBusiness(true)).toBe("index, follow");
	});

	it("noindexes AND nofollows a withheld business page", () => {
		// Unlike listing pages, a withdrawn business page has nothing worth
		// crawling — so it is nofollow, not follow.
		expect(robotsForBusiness(false)).toBe("noindex, nofollow");
	});
});

describe("canonicalFor", () => {
	it("prefixes the https apex origin to a page path", () => {
		expect(canonicalFor("/warszawa/hydraulik-warszawa")).toBe(
			"https://wizytowka.link/warszawa/hydraulik-warszawa",
		);
	});

	it("strips trailing slashes so /x/ and /x share one canonical", () => {
		expect(canonicalFor("/warszawa/hydraulik-warszawa/")).toBe(
			"https://wizytowka.link/warszawa/hydraulik-warszawa",
		);
		// The landing page: root path collapses to the bare apex, no trailing "/".
		expect(canonicalFor("/")).toBe("https://wizytowka.link");
	});
});
