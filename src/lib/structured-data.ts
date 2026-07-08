import { formatOperatingHours } from "./operating-hours";

export interface BizData {
	title: string;
	phone: string;
	address: string;
	category: string;
	gps_lat: number;
	gps_lng: number;
	rating: number | null;
	reviews_count: number | null;
	operating_hours?: string | null;
}

export function safeJsonScript(value: unknown): string {
	return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function buildLocalBusinessLd(biz: BizData, _url: string) {
	const openingHours = formatOperatingHours(biz.operating_hours).schema;
	return {
		"@context": "https://schema.org",
		"@type": "LocalBusiness",
		name: biz.title,
		address: {
			"@type": "PostalAddress",
			streetAddress: biz.address,
			addressCountry: "PL",
		},
		...(openingHours.length ? { openingHours } : {}),
		geo: {
			"@type": "GeoCoordinates",
			latitude: biz.gps_lat,
			longitude: biz.gps_lng,
		},
		...(biz.rating && biz.reviews_count
			? {
					aggregateRating: {
						"@type": "AggregateRating",
						ratingValue: biz.rating,
						bestRating: 5,
						ratingCount: biz.reviews_count,
					},
				}
			: {}),
	};
}

export function buildBreadcrumbLd(
	seoTitle: string,
	locSlug: string,
	locName: string,
) {
	return {
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: [
			{
				"@type": "ListItem",
				position: 1,
				name: "Strona główna",
				item: "https://wizytowka.link/",
			},
			{
				"@type": "ListItem",
				position: 2,
				name: locName,
				item: `https://wizytowka.link/${locSlug}`,
			},
			{ "@type": "ListItem", position: 3, name: seoTitle },
		],
	};
}
