import { describe, expect, it } from "vitest";
import { formatLocalityLabel } from "./locality-label";

describe("formatLocalityLabel", () => {
	it("renders the full canonical format with all three parts", () => {
		expect(
			formatLocalityLabel({
				name: "Brzezie",
				gmi_name: "Kłaj",
				pow_name: "wielicki",
			}),
		).toBe("Brzezie, gm. Kłaj, pow. wielicki");
	});

	it("preserves Polish characters verbatim (no slugification)", () => {
		expect(
			formatLocalityLabel({
				name: "Łódź",
				gmi_name: "Łódź",
				pow_name: "łódzki",
			}),
		).toBe("Łódź, gm. Łódź, pow. łódzki");
	});
});
