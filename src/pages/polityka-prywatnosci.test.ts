import { describe, expect, it } from "vitest";
import privacyPolicySource from "./polityka-prywatnosci.astro?raw";

describe("privacy policy AI chat coverage", () => {
	it("explicitly covers stored AI assistant conversations", () => {
		// Assumptions for issue #48:
		// Privacy policy coverage can be verified from the committed page source before launch.
		// The policy must mention AI assistant conversations, storage, and answer-quality review.
		// This iteration does not define a numeric retention period.
		const text = privacyPolicySource.toLowerCase();

		expect(text).toContain("rozmowy z asystentem ai");
		expect(text).toContain("mogą być zapisywane");
		expect(text).toContain("jakość odpowiedzi");
	});
});
