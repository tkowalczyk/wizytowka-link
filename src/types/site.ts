export interface SiteHero {
	headline: string;
	subheadline: string;
}

export interface SiteAbout {
	title: string;
	text: string;
}

export interface SiteService {
	name: string;
	description: string;
}

export interface SiteContact {
	cta_text: string;
	phone: string;
	address: string;
}

export interface SiteSeo {
	title: string;
	description: string;
}

export interface SiteContent {
	hero: SiteHero;
	about: SiteAbout;
	services: SiteService[];
	contact: SiteContact;
	seo: SiteSeo;
}

export interface SiteData extends SiteContent {
	theme?: string;
	layout?: string;
	style?: string;
}

export interface PresentationOverrides {
	paletteId?: string;
	layout?: import("../lib/themes").LayoutVariant;
	style?: import("../lib/themes").StyleVariant;
}
