import { describe, expect, it } from "vitest";
import { isLayoutVariant, isStyleVariant } from "./themes";

describe("isLayoutVariant", () => {
	it("accepts every known layout variant", () => {
		expect(isLayoutVariant("centered")).toBe(true);
		expect(isLayoutVariant("split")).toBe(true);
		expect(isLayoutVariant("minimal")).toBe(true);
	});

	it("rejects unknown or malformed values", () => {
		expect(isLayoutVariant("hero")).toBe(false);
		expect(isLayoutVariant("")).toBe(false);
		expect(isLayoutVariant(undefined)).toBe(false);
		expect(isLayoutVariant(null)).toBe(false);
		expect(isLayoutVariant(42)).toBe(false);
	});
});

describe("isStyleVariant", () => {
	it("accepts every known style variant", () => {
		expect(isStyleVariant("modern")).toBe(true);
		expect(isStyleVariant("elegant")).toBe(true);
		expect(isStyleVariant("bold")).toBe(true);
	});

	it("rejects unknown or malformed values", () => {
		expect(isStyleVariant("fancy")).toBe(false);
		expect(isStyleVariant("")).toBe(false);
		expect(isStyleVariant(undefined)).toBe(false);
		expect(isStyleVariant(null)).toBe(false);
		expect(isStyleVariant(42)).toBe(false);
	});
});
