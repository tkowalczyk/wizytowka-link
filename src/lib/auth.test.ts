import { describe, expect, it } from "vitest";
import { timingSafeCompare } from "./auth";

describe("timingSafeCompare", () => {
	it("returns true for byte-identical strings", async () => {
		await expect(
			timingSafeCompare("secret-token-abc", "secret-token-abc"),
		).resolves.toBe(true);
	});

	it("returns false for same-length strings that differ", async () => {
		await expect(
			timingSafeCompare("secret-token-aaa", "secret-token-bbb"),
		).resolves.toBe(false);
	});

	it("returns false for strings of different lengths", async () => {
		await expect(timingSafeCompare("short", "much-longer-token")).resolves.toBe(
			false,
		);
	});

	it("returns false when provided is null, undefined, or empty", async () => {
		await expect(timingSafeCompare(null, "expected")).resolves.toBe(false);
		await expect(timingSafeCompare(undefined, "expected")).resolves.toBe(false);
		await expect(timingSafeCompare("", "expected")).resolves.toBe(false);
	});

	it("does not let nullish provided coerce into matching string literals", async () => {
		// guards against TextEncoder coercing null→"null", undefined→"undefined"
		await expect(timingSafeCompare(null, "null")).resolves.toBe(false);
		await expect(timingSafeCompare(undefined, "undefined")).resolves.toBe(
			false,
		);
	});
});
