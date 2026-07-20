import { describe, expect, it } from "vitest";
import businessSource from "../components/BusinessSite.astro?raw";
import localitySource from "./[loc]/index.astro?raw";
import categorySource from "./[loc]/kategoria/[category].astro?raw";
import homeSource from "./index.astro?raw";
import privacySource from "./polityka-prywatnosci.astro?raw";
import termsSource from "./regulamin.astro?raw";

const publicPageSources = [
	homeSource,
	localitySource,
	categorySource,
	businessSource,
	termsSource,
	privacySource,
];

describe("public page metadata", () => {
	it("indexes public legal and trust pages", () => {
		for (const source of [termsSource, privacySource]) {
			expect(source).toContain('content="index, follow"');
			expect(source).not.toContain('content="noindex"');
		}
	});

	it("uses the shared social image on every indexable page type", () => {
		for (const source of publicPageSources) {
			expect(source).toContain("SOCIAL_IMAGE");
			expect(source).toContain('property="og:image"');
			expect(source).toContain('name="twitter:image"');
		}
	});

	it("emits matching OpenGraph and Twitter titles and descriptions", () => {
		for (const source of publicPageSources) {
			expect(source).toContain('property="og:title"');
			expect(source).toContain('property="og:description"');
			expect(source).toContain('name="twitter:title"');
			expect(source).toContain('name="twitter:description"');
		}
	});
});
