import { describe, expect, it } from "vitest";
import {
	getPaletteById,
	isLayoutVariant,
	isStyleVariant,
	resolveTheme,
} from "./themes";

describe("getPaletteById", () => {
	// Assumptions: palette ids are plain strings; prototype-member names are not
	// valid palette ids; this slice does not validate persisted override shape.
	it("treats prototype-chain keys as unknown palettes", () => {
		expect(getPaletteById("constructor")).toBeUndefined();
	});
});

describe("resolveTheme", () => {
	// Assumptions: scraped categories are untrusted strings; unknown categories
	// fall back to the general palette pool; this slice does not test hashing.
	it("does not throw for prototype-chain category names", () => {
		expect(() => resolveTheme("some-slug", "Constructor")).not.toThrow();
	});
});

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
