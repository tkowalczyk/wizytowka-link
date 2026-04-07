import { describe, expect, it } from "vitest";
import { normalizePhone } from "./phone";

describe("normalizePhone", () => {
	it("passes through +48 prefixed 9-digit number", () => {
		expect(normalizePhone("+48123456789")).toBe("+48123456789");
	});

	it("adds +48 to bare 9-digit number", () => {
		expect(normalizePhone("123456789")).toBe("+48123456789");
	});

	it("adds + to 48-prefixed 11-digit string", () => {
		expect(normalizePhone("48123456789")).toBe("+48123456789");
	});

	it("strips spaces before normalizing", () => {
		expect(normalizePhone("123 456 789")).toBe("+48123456789");
	});

	it("strips dashes before normalizing", () => {
		expect(normalizePhone("123-456-789")).toBe("+48123456789");
	});

	it("returns null for too-short number", () => {
		expect(normalizePhone("12345")).toBeNull();
	});

	it("returns null for empty string", () => {
		expect(normalizePhone("")).toBeNull();
	});

	it("returns null for letters", () => {
		expect(normalizePhone("abcdefghi")).toBeNull();
	});
});
