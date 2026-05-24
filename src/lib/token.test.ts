import { describe, expect, it } from "vitest";
import { generateOwnerToken } from "./token";

describe("generateOwnerToken", () => {
	it("emits biz_ prefix + 32 lowercase hex chars", () => {
		const token = generateOwnerToken();
		expect(token).toMatch(/^biz_[0-9a-f]{32}$/);
	});

	it("produces a different token on each call", () => {
		const a = generateOwnerToken();
		const b = generateOwnerToken();
		expect(a).not.toBe(b);
	});
});
