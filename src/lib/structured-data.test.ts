import { describe, expect, it } from "vitest";
import {
	type BizData,
	buildBreadcrumbLd,
	buildLocalBusinessLd,
	safeJsonScript,
} from "./structured-data";

const baseBiz: BizData = {
	title: "Bistro Drewnica",
	phone: "+48 504 405 176",
	address: "Wojska Polskiego 34, 05-091 Ząbki, Poland",
	category: "restauracja",
	gps_lat: 52.2978702,
	gps_lng: 21.1100277,
	rating: 4.7,
	reviews_count: 98,
	// The real persisted shape: JSON.stringify of the scraped
	// Record<string, string> keyed by lowercase English day names.
	operating_hours: JSON.stringify({
		monday: "9 AM to 5 PM",
		tuesday: "9 AM to 5 PM",
		wednesday: "9 AM to 5 PM",
		thursday: "9 AM to 5 PM",
		friday: "9 AM to 5 PM",
		saturday: "10 AM to 2 PM",
		sunday: "Closed",
	}),
};

describe("buildLocalBusinessLd", () => {
	// Assumptions for issue #44:
	// Input is the current business row shape used by generated pages.
	// Output is LocalBusiness JSON-LD with no direct contact fields exposed.
	it("omits direct contact fields and emits schema.org-format opening hours", () => {
		const url = "https://wizytowka.link/zabki/bistro";
		const ld = buildLocalBusinessLd(baseBiz, url);

		expect(ld).not.toHaveProperty("telephone");
		expect(ld).not.toHaveProperty("email");
		expect(ld.url).toBe(url);
		expect(ld.address).toEqual({
			"@type": "PostalAddress",
			streetAddress: baseBiz.address,
			addressCountry: "PL",
		});
		expect(ld.openingHours).toEqual(["Mo-Fr 09:00-17:00", "Sa 10:00-14:00"]);
		for (const entry of ld.openingHours as string[]) {
			expect(entry).toMatch(
				/^[A-Z][a-z](-[A-Z][a-z])? \d{2}:\d{2}-\d{2}:\d{2}$/,
			);
		}
	});

	it("omits openingHours entirely for unparseable input", () => {
		const ld = buildLocalBusinessLd(
			{ ...baseBiz, operating_hours: "call us maybe" },
			"https://wizytowka.link/zabki/bistro",
		);
		expect(ld).not.toHaveProperty("openingHours");
	});

	it("does not republish third-party aggregate ratings as first-party schema", () => {
		const ld = buildLocalBusinessLd(
			baseBiz,
			"https://wizytowka.link/zabki/bistro",
		);
		expect(ld).not.toHaveProperty("aggregateRating");
	});

	it("omits aggregateRating when reviews_count is null", () => {
		const ld = buildLocalBusinessLd(
			{ ...baseBiz, reviews_count: null },
			"https://wizytowka.link/zabki/bistro",
		);
		expect(ld).not.toHaveProperty("aggregateRating");
	});

	it("omits aggregateRating when rating is null", () => {
		const ld = buildLocalBusinessLd(
			{ ...baseBiz, rating: null },
			"https://wizytowka.link/zabki/bistro",
		);
		expect(ld).not.toHaveProperty("aggregateRating");
	});

	it("omits aggregateRating when both null", () => {
		const ld = buildLocalBusinessLd(
			{ ...baseBiz, rating: null, reviews_count: null },
			"https://wizytowka.link/zabki/bistro",
		);
		expect(ld).not.toHaveProperty("aggregateRating");
	});

	it("sets correct @type and @context", () => {
		const ld = buildLocalBusinessLd(
			baseBiz,
			"https://wizytowka.link/zabki/bistro",
		);
		expect(ld["@context"]).toBe("https://schema.org");
		expect(ld["@type"]).toBe("LocalBusiness");
	});

	it("includes address with PostalAddress type", () => {
		const ld = buildLocalBusinessLd(
			baseBiz,
			"https://wizytowka.link/zabki/bistro",
		);
		expect(ld.address).toEqual({
			"@type": "PostalAddress",
			streetAddress: baseBiz.address,
			addressCountry: "PL",
		});
	});

	it("sets the canonical page URL on LocalBusiness metadata", () => {
		const url = "https://wizytowka.link/zabki/bistro";
		const ld = buildLocalBusinessLd(baseBiz, url);
		expect(ld.url).toBe(url);
	});
});

describe("buildBreadcrumbLd", () => {
	it("builds 3-level breadcrumb", () => {
		const ld = buildBreadcrumbLd("Bistro Drewnica", "zabki-0921958", "Ząbki");
		expect(ld["@type"]).toBe("BreadcrumbList");
		expect(ld.itemListElement).toHaveLength(3);
		expect(ld.itemListElement[1].item).toBe(
			"https://wizytowka.link/zabki-0921958",
		);
		expect(ld.itemListElement[2].name).toBe("Bistro Drewnica");
	});

	it("does not include trailing slash in locality URL", () => {
		const ld = buildBreadcrumbLd("Test", "krakow", "Kraków");
		expect(ld.itemListElement[1].item).not.toMatch(/\/$/);
	});
});

describe("safeJsonScript", () => {
	it("escapes closing script tags in JSON values", () => {
		const json = safeJsonScript({
			name: '</script><img src=x onerror=alert("xss")>',
		});

		expect(json).not.toContain("</script>");
		expect(json).toContain("\\u003c/script>");
		expect(JSON.parse(json)).toEqual({
			name: '</script><img src=x onerror=alert("xss")>',
		});
	});
});
