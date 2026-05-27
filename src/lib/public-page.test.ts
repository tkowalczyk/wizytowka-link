import { describe, expect, it } from "vitest";
import type { SiteData } from "../types/site";
import {
	ASSISTANT_CTA_LABEL,
	ASSISTANT_FIRST_MESSAGE,
	ASSISTANT_PRIVACY_NOTICE,
	buildPublicBusinessPageModel,
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
