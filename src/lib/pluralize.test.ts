import { describe, expect, it } from "vitest";
import { pluralizeFirma } from "./pluralize";

describe("pluralizeFirma", () => {
	// Assumptions: counts are non-negative integers; Polish 2-4 plural applies
	// when the final two digits are not 12-14; this slice only returns the noun.
	it("returns the Polish form for a business count", () => {
		expect(pluralizeFirma(1)).toBe("firma");
		expect(pluralizeFirma(2)).toBe("firmy");
		expect(pluralizeFirma(5)).toBe("firm");
		expect(pluralizeFirma(12)).toBe("firm");
		expect(pluralizeFirma(22)).toBe("firmy");
	});
});
