import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, TEST_IDS } from "../../test/seed";
import type { SiteData } from "../types/site";
import { createDraftPreviewToken } from "./draft-preview";
import {
	deleteSite,
	getPublishedOrPreviewSite,
	getSite,
	promoteDraft,
	putSite,
	siteKey,
} from "./site-store";

const SAMPLE: SiteData = {
	hero: { headline: "Witamy", subheadline: "Najlepsza firma" },
	about: { title: "O nas", text: "Opis firmy" },
	services: [{ name: "Usługa 1", description: "Opis usługi" }],
	contact: { cta_text: "Zadzwoń", phone: "123456789", address: "ul. Test 1" },
	seo: { title: "Firma", description: "Opis SEO" },
};

describe("siteKey", () => {
	it("returns live R2 path", () => {
		expect(siteKey("live", "krakow", "foo-bar")).toBe(
			"sites/krakow/foo-bar.json",
		);
	});

	it("returns draft R2 path", () => {
		expect(siteKey("draft", "krakow", "foo-bar")).toBe(
			"sites/draft/krakow/foo-bar.json",
		);
	});
});

describe("putSite + getSite", () => {
	it("round-trips SiteData through R2", async () => {
		await putSite(env.sites, "live", "krakow", "test-biz", SAMPLE);
		const result = await getSite(env.sites, "live", "krakow", "test-biz");
		expect(result).toEqual(SAMPLE);
	});

	it("returns null for missing key", async () => {
		const result = await getSite(env.sites, "live", "krakow", "nonexistent");
		expect(result).toBeNull();
	});
});

describe("getPublishedOrPreviewSite", () => {
	beforeEach(async () => {
		await resetDb(env.leadgen);
	});

	it("does not return draft R2 content when draft=1 has no preview token", async () => {
		await putSite(env.sites, "draft", "warszawa", "hydraulik-warszawa", SAMPLE);

		const result = await getPublishedOrPreviewSite(
			env.sites,
			env.leadgen,
			"warszawa",
			"hydraulik-warszawa",
			{ isDraft: true, previewToken: null },
		);

		expect(result).toBeNull();
	});

	it("returns draft R2 content when the preview token matches the business", async () => {
		await putSite(env.sites, "draft", "warszawa", "hydraulik-warszawa", SAMPLE);
		const token = await createDraftPreviewToken(
			env.leadgen,
			TEST_IDS.businesses.hydraulikWarszawa,
		);

		const result = await getPublishedOrPreviewSite(
			env.sites,
			env.leadgen,
			"warszawa",
			"hydraulik-warszawa",
			{ isDraft: true, previewToken: token },
		);

		expect(result).toEqual(SAMPLE);
	});

	it("returns live R2 content without requiring a preview token", async () => {
		await putSite(env.sites, "live", "krakow", "promo-biz", SAMPLE);

		const result = await getPublishedOrPreviewSite(
			env.sites,
			env.leadgen,
			"krakow",
			"promo-biz",
			{ isDraft: false, previewToken: null },
		);

		expect(result).toEqual(SAMPLE);
	});
});

describe("promoteDraft", () => {
	it("copies draft to live and deletes draft", async () => {
		await putSite(env.sites, "draft", "krakow", "promo-biz", SAMPLE);
		const ok = await promoteDraft(env.sites, "krakow", "promo-biz");
		expect(ok).toBe(true);
		expect(await getSite(env.sites, "live", "krakow", "promo-biz")).toEqual(
			SAMPLE,
		);
		expect(await getSite(env.sites, "draft", "krakow", "promo-biz")).toBeNull();
	});

	it("returns false when no draft exists", async () => {
		const ok = await promoteDraft(env.sites, "krakow", "no-draft");
		expect(ok).toBe(false);
	});
});

describe("deleteSite", () => {
	it("removes the key from R2", async () => {
		await putSite(env.sites, "live", "krakow", "del-biz", SAMPLE);
		await deleteSite(env.sites, "live", "krakow", "del-biz");
		expect(await getSite(env.sites, "live", "krakow", "del-biz")).toBeNull();
	});
});
