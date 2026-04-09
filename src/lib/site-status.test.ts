import { describe, expect, it } from "vitest";
import { classifyBusinessSiteStatus } from "./site-status";

describe("classifyBusinessSiteStatus", () => {
	it("returns pending when phone is present and website is missing", () => {
		expect(
			classifyBusinessSiteStatus({ website: null, phone: "+48123456789" }),
		).toEqual({ status: "pending", reason: null });
	});

	it("returns ineligible/no_phone when phone is missing and no website", () => {
		expect(classifyBusinessSiteStatus({ website: null, phone: null })).toEqual({
			status: "ineligible",
			reason: "no_phone",
		});
	});

	it("returns ineligible/has_website when website is present", () => {
		expect(
			classifyBusinessSiteStatus({
				website: "https://example.pl",
				phone: "+48123456789",
			}),
		).toEqual({ status: "ineligible", reason: "has_website" });
	});

	it("prefers has_website over no_phone when both website present and phone missing", () => {
		expect(
			classifyBusinessSiteStatus({
				website: "https://example.pl",
				phone: null,
			}),
		).toEqual({ status: "ineligible", reason: "has_website" });
	});

	it("treats empty strings as missing (SerpAPI edge case)", () => {
		expect(classifyBusinessSiteStatus({ website: "", phone: "" })).toEqual({
			status: "ineligible",
			reason: "no_phone",
		});
		expect(
			classifyBusinessSiteStatus({ website: "", phone: "+48123456789" }),
		).toEqual({ status: "pending", reason: null });
	});
});
