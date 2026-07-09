import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../../test/seed";
import { putSite } from "../../lib/site-store";
import type { SiteData } from "../../types/site";
import { GET } from "./[slug].md";

const STUB_SITE: SiteData = {
	hero: { headline: "Hydraulik Warszawa", subheadline: "Szybka pomoc" },
	about: { title: "O firmie", text: "Opis firmy." },
	services: [{ name: "Naprawa", description: "Usuwanie awarii" }],
	contact: {
		cta_text: "Zadzwoń",
		phone: "+48123456789",
		address: "ul. Marszałkowska 1, Warszawa",
	},
	seo: { title: "Hydraulik Warszawa", description: "Lokalna firma" },
};

const invoke = (loc: string, slug: string) =>
	GET({ params: { loc, slug } } as unknown as Parameters<typeof GET>[0]);

const parseMaxAge = (header: string | null): number | null => {
	const match = header?.match(/(?:^|[,\s])max-age=(\d+)/i);
	return match ? Number(match[1]) : null;
};

// Issue #72 gap 2: the .md export served any live R2 object unconditionally,
// with no site_status check — so a business withdrawn from 'done' (owner
// removal, GDPR erasure, re-classification) stayed live + machine-readable
// while disappearing from every list. The export must gate on site_status.
describe("GET [slug].md", () => {
	beforeEach(async () => {
		await resetDb(env.leadgen);
		const list = await env.sites.list();
		for (const obj of list.objects) {
			await env.sites.delete(obj.key);
		}
	});

	it("serves markdown for a live, done business with a short max-age", async () => {
		await putSite(
			env.sites,
			"live",
			"warszawa",
			"hydraulik-warszawa",
			STUB_SITE,
		);

		const res = await invoke("warszawa", "hydraulik-warszawa");

		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toContain("text/markdown");
		expect(
			parseMaxAge(res.headers.get("Cache-Control")) ?? 0,
		).toBeLessThanOrEqual(300);
		expect(await res.text()).toContain("Hydraulik Warszawa");
	});

	it("returns 410 Gone when the live object exists but site_status is not done", async () => {
		// Business 5 (sklep-agd, warszawa) is seeded with site_status='ineligible'.
		await putSite(env.sites, "live", "warszawa", "sklep-agd", STUB_SITE);

		const res = await invoke("warszawa", "sklep-agd");

		expect(res.status).toBe(410);
	});

	it("returns 404 when no live object exists", async () => {
		const res = await invoke("warszawa", "hydraulik-warszawa");

		expect(res.status).toBe(404);
	});

	it("returns 410 when a live object outlives its D1 business row", async () => {
		// A stale R2 key whose D1 join returns null (business removed/renamed)
		// must not be served as machine-readable content — issue #81 biz-null hole.
		await putSite(env.sites, "live", "warszawa", "ghost-business", STUB_SITE);

		const res = await invoke("warszawa", "ghost-business");

		expect(res.status).toBe(410);
	});
});
