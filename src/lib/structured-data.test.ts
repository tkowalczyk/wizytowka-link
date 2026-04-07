import { describe, expect, it } from "vitest";
import {
	type BizData,
	buildBreadcrumbLd,
	buildLocalBusinessLd,
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
};

describe("buildLocalBusinessLd", () => {
	it("includes ratingCount when both rating and reviews_count present", () => {
		const ld = buildLocalBusinessLd(
			baseBiz,
			"https://wizytowka.link/zabki/bistro",
		);
		expect(ld.aggregateRating).toEqual({
			"@type": "AggregateRating",
			ratingValue: 4.7,
			bestRating: 5,
			ratingCount: 98,
		});
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

	it("passes url through", () => {
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
