export interface SiteHero {
  title: string;
  subtitle: string;
}

export interface SiteData {
  business: {
    title: string;
    slug: string;
    phone: string;
    address: string | null;
    category: string;
    rating: number | null;
  };
  locality: {
    name: string;
    slug: string;
  };
  hero: SiteHero;
  generated_at: string;
}
