import { describe, expect, it } from "vitest";
import type { SiteData } from "../types/site";
import {
	ASSISTANT_CTA_LABEL,
	ASSISTANT_FIRST_MESSAGE,
	ASSISTANT_PRIVACY_NOTICE,
	buildPublicBusinessPageModel,
	publicCacheControl,
} from "./public-page";
import type { BizData } from "./structured-data";

const site: SiteData = {
	hero: {
		headline: "Hydraulik Warszawa",
		subheadline: "Szybka pomoc hydrauliczna w okolicy",
	},
	about: {
		title: "O firmie",
		text: "Opis firmy i zakres prac pozostaje widoczny.",
	},
	services: [
		{ name: "Naprawa awarii", description: "Usuwanie przecieków" },
		{ name: "Montaż baterii", description: "Instalacje łazienkowe" },
	],
	contact: {
		cta_text: "Zadzwoń +48 123 456 789",
		phone: "+48 123 456 789",
		address: "ul. Marszałkowska 1, Warszawa",
	},
	seo: {
		title: "Hydraulik Warszawa",
		description: "Lokalna firma hydrauliczna",
	},
};

const biz: BizData = {
	title: "Hydraulik Warszawa",
	phone: "+48 123 456 789",
	address: "ul. Marszałkowska 1, Warszawa",
	category: "hydraulik",
	gps_lat: 52.2297,
	gps_lng: 21.0122,
	rating: 4.5,
	reviews_count: 42,
	operating_hours: "Pon-Pt 09:00-17:00",
};

describe("buildPublicBusinessPageModel", () => {
	// Assumptions for issue #44:
	// Input is generated SiteData plus the current DB business row.
	// Output is the page model consumed by Astro layouts, with direct contact data stripped.
	// This iteration does not test browser execution of the chat-opening script.
	it("suppresses direct contact fields and keeps non-contact page context", () => {
		const model = buildPublicBusinessPageModel(site, biz);

		expect(model.assistantCtaLabel).toBe(ASSISTANT_CTA_LABEL);
		expect(model.directContact.phone).toBeNull();
		expect(model.directContact.email).toBeNull();
		expect(model.directContact.contactUrl).toBeNull();
		expect(model.location.address).toBe(site.contact.address);
		expect(model.location.openingHours).toBe(biz.operating_hours);
		expect(decodeURIComponent(model.location.mapHref ?? "")).toContain(
			"52.2297,21.0122",
		);
		expect(model.aboutText).toBe(site.about.text);
		expect(model.services.map((service) => service.name)).toEqual([
			"Naprawa awarii",
			"Montaż baterii",
		]);
		expect(model.chat.firstMessage).toBe(ASSISTANT_FIRST_MESSAGE);
		expect(model.chat.privacyNotice).toBe(ASSISTANT_PRIVACY_NOTICE);
	});

	it("renders operating hours as human-readable Polish text, not a JSON blob", () => {
		// The exact shape toBusiness() persists: JSON.stringify of a
		// Record<string, string> keyed by lowercase English day names.
		const scrapedHours = JSON.stringify({
			monday: "9 AM to 5 PM",
			tuesday: "9 AM to 5 PM",
		});
		const model = buildPublicBusinessPageModel(site, {
			...biz,
			operating_hours: scrapedHours,
		});

		expect(model.location.openingHours).not.toMatch(/^\{/);
		expect(model.location.openingHours).toContain("poniedziałek");
		expect(model.location.openingHours).toContain("09:00");
	});

	it("builds public SEO metadata without direct contact details", () => {
		// Assumptions for issue #48:
		// Input SEO text may contain direct phone, email, or contact URL generated before contact suppression.
		// Output SEO text is safe for meta description and OpenGraph description.
		// This iteration does not rewrite canonical or OpenGraph page URLs owned by wizytowka.link.
		const model = buildPublicBusinessPageModel(
			{
				...site,
				seo: {
					title: "Hydraulik Warszawa",
					description:
						"Lokalna firma hydrauliczna. Tel: +48 123 456 789, email kontakt@hydraulik.example, kontakt https://hydraulik.example/kontakt.",
				},
			},
			biz,
		);

		expect(model.seo.description).toContain("Lokalna firma hydrauliczna");
		expect(model.seo.description).not.toContain("+48 123 456 789");
		expect(model.seo.description).not.toContain("kontakt@hydraulik.example");
		expect(model.seo.description).not.toContain(
			"https://hydraulik.example/kontakt",
		);
	});

	it("does not expose seller terminology in visitor-facing assistant copy", () => {
		const model = buildPublicBusinessPageModel(site, biz);
		const renderedCopy = [
			model.assistantCtaLabel,
			model.chat.firstMessage,
			model.chat.privacyNotice,
			model.aboutText,
			...model.services.flatMap((service) => [
				service.name,
				service.description,
			]),
		].join("\n");

		expect(renderedCopy.toLowerCase()).not.toContain("seller");
		expect(renderedCopy.toLowerCase()).not.toContain("sprzedaw");
	});
});

describe("publicCacheControl", () => {
	// Issue #72 gap 1: promoteDraft/changeTheme perform no cache purge, so the old
	// 24h browser max-age broke the owner's approve-then-verify loop. Decision (a):
	// lower browser max-age to <= 5 min so the canonical URL self-heals quickly.
	const parseMaxAge = (header: string): number | null => {
		const match = header.match(/(?:^|[,\s])max-age=(\d+)/i);
		return match ? Number(match[1]) : null;
	};

	it("keeps the browser max-age at or below 300 seconds", () => {
		const maxAge = parseMaxAge(publicCacheControl());
		expect(maxAge).not.toBeNull();
		expect(maxAge as number).toBeLessThanOrEqual(300);
	});

	it("stays publicly cacheable", () => {
		expect(publicCacheControl()).toMatch(/(?:^|[,\s])public(?:[,\s]|$)/);
	});
});
