import type { SiteData, SiteService } from "../types/site";
import type { BizData } from "./structured-data";

export const ASSISTANT_CTA_LABEL = "Zapytaj asystenta";
export const ASSISTANT_FIRST_MESSAGE =
	"Cześć! Jestem asystentem AI i nie reprezentuję bezpośrednio tego miejsca. Zapytaj mnie o to miejsce - jeśli sprawa wymaga kontaktu z człowiekiem, podpowiem Ci najlepszy następny krok.";
export const ASSISTANT_PRIVACY_NOTICE =
	"Rozmowa jest obsługiwana przez asystenta AI i może zostać zapisana, aby poprawiać jakość odpowiedzi.";

export interface PublicBusinessPageModel {
	assistantCtaLabel: string;
	aboutText: string;
	services: SiteService[];
	directContact: {
		phone: null;
		email: null;
		contactUrl: null;
	};
	location: {
		address: string;
		openingHours: string | null;
		mapHref: string | null;
	};
	chat: {
		firstMessage: string;
		privacyNotice: string;
	};
	seo: {
		title: string;
		description: string;
	};
}

const EMAIL_PATTERN =
	/\b(?:e-?mail|mail|kontakt)?\s*:?\s*[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const URL_PATTERN =
	/\b(?:kontakt|strona)?\s*:?\s*(?:https?:\/\/|www\.)[^\s<>"']+/gi;
const PHONE_PATTERN =
	/\b(?:tel(?:efon)?\.?:?\s*)?(?:\+?48[\s.-]?)?(?:\d[\s.-]?){9,}\b/gi;

function buildMapHref(biz: BizData | null): string | null {
	if (biz?.gps_lat != null && biz.gps_lng != null) {
		return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${biz.gps_lat},${biz.gps_lng}`)}`;
	}
	if (biz?.address) {
		return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(biz.address)}`;
	}
	return null;
}

function stripDirectContactDetails(text: string): string {
	return text
		.replace(EMAIL_PATTERN, "")
		.replace(URL_PATTERN, "")
		.replace(PHONE_PATTERN, "")
		.replace(/\s+([,.!?])/g, "$1")
		.replace(/(?:\s*[,;:]\s*){2,}/g, ", ")
		.replace(/(?:\s*[,;:]\s*)+\./g, ".")
		.replace(/\s{2,}/g, " ")
		.trim();
}

function safePublicMetadataText(...candidates: string[]): string {
	for (const candidate of candidates) {
		const cleaned = stripDirectContactDetails(candidate);
		if (cleaned) return cleaned;
	}
	return "Informacje o lokalnej firmie.";
}

export function buildPublicBusinessPageModel(
	site: SiteData,
	biz: BizData | null,
): PublicBusinessPageModel {
	return {
		assistantCtaLabel: ASSISTANT_CTA_LABEL,
		aboutText: site.about.text,
		services: site.services,
		directContact: {
			phone: null,
			email: null,
			contactUrl: null,
		},
		location: {
			address: site.contact.address,
			openingHours: biz?.operating_hours ?? null,
			mapHref: buildMapHref(biz),
		},
		chat: {
			firstMessage: ASSISTANT_FIRST_MESSAGE,
			privacyNotice: ASSISTANT_PRIVACY_NOTICE,
		},
		seo: {
			title: safePublicMetadataText(site.seo.title, site.hero.headline),
			description: safePublicMetadataText(
				site.seo.description,
				site.about.text,
				site.hero.subheadline,
			),
		},
	};
}
