import { describe, expect, it } from "vitest";
import { slugify } from "./slug";

describe("slugify", () => {
	it("lowercases ASCII input", () => {
		expect(slugify("Hydraulik")).toBe("hydraulik");
	});

	it("converts Polish ą ć ę ł ń ó ś ź ż to ASCII equivalents", () => {
		expect(slugify("ąćęłńóśźż")).toBe("acelnoszz");
	});

	it("converts uppercase Polish letters to ASCII equivalents", () => {
		expect(slugify("ĄĆĘŁŃÓŚŹŻ")).toBe("acelnoszz");
	});

	it("replaces spaces with hyphens", () => {
		expect(slugify("fryzjerstwo i kosmetyka")).toBe("fryzjerstwo-i-kosmetyka");
	});

	it("replaces consecutive special chars with a single hyphen", () => {
		expect(slugify("foo  bar")).toBe("foo-bar");
	});

	it("strips leading and trailing hyphens", () => {
		expect(slugify("  foo  ")).toBe("foo");
	});

	it("handles empty string", () => {
		expect(slugify("")).toBe("");
	});

	it("produces correct category URL segment for Polish category name", () => {
		const category = "Usługi hydrauliczne";
		const locSlug = "warszawa";
		const url = `/${locSlug}/kategoria/${slugify(category)}`;
		expect(url).toBe("/warszawa/kategoria/uslugi-hydrauliczne");
	});

	it("produces correct category URL segment for category with numbers", () => {
		expect(slugify("24h serwis")).toBe("24h-serwis");
	});
});
