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

export interface SiteData {
  hero: SiteHero;
  about: SiteAbout;
  services: SiteService[];
  contact: SiteContact;
  seo: SiteSeo;
}
