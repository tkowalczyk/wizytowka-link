export type LayoutVariant = 'centered' | 'split' | 'minimal';

export interface ThemeColors {
  heroBg: string;
  heroText: string;
  heroAccent: string;
  ctaBg: string;
  ctaText: string;
  ctaHover: string;
  contactBg: string;
  contactText: string;
  cardBg: string;
  sectionBg: string;
}

export interface ThemeConfig {
  id: string;
  colors: ThemeColors;
  layout: LayoutVariant;
}

const PALETTES: Record<string, ThemeColors> = {
  ocean: {
    heroBg: 'bg-gradient-to-br from-blue-600 to-blue-800',
    heroText: 'text-white',
    heroAccent: 'text-blue-100',
    ctaBg: 'bg-white',
    ctaText: 'text-blue-700',
    ctaHover: 'hover:bg-blue-50',
    contactBg: 'bg-blue-600',
    contactText: 'text-white',
    cardBg: 'bg-gray-50',
    sectionBg: 'bg-white',
  },
  forest: {
    heroBg: 'bg-gradient-to-br from-emerald-600 to-emerald-800',
    heroText: 'text-white',
    heroAccent: 'text-emerald-100',
    ctaBg: 'bg-white',
    ctaText: 'text-emerald-700',
    ctaHover: 'hover:bg-emerald-50',
    contactBg: 'bg-emerald-600',
    contactText: 'text-white',
    cardBg: 'bg-emerald-50',
    sectionBg: 'bg-white',
  },
  sunset: {
    heroBg: 'bg-gradient-to-br from-amber-500 to-orange-600',
    heroText: 'text-white',
    heroAccent: 'text-amber-100',
    ctaBg: 'bg-white',
    ctaText: 'text-orange-700',
    ctaHover: 'hover:bg-orange-50',
    contactBg: 'bg-orange-600',
    contactText: 'text-white',
    cardBg: 'bg-amber-50',
    sectionBg: 'bg-white',
  },
  royal: {
    heroBg: 'bg-gradient-to-br from-purple-600 to-indigo-800',
    heroText: 'text-white',
    heroAccent: 'text-purple-200',
    ctaBg: 'bg-white',
    ctaText: 'text-purple-700',
    ctaHover: 'hover:bg-purple-50',
    contactBg: 'bg-indigo-700',
    contactText: 'text-white',
    cardBg: 'bg-purple-50',
    sectionBg: 'bg-white',
  },
  crimson: {
    heroBg: 'bg-gradient-to-br from-red-600 to-rose-800',
    heroText: 'text-white',
    heroAccent: 'text-red-100',
    ctaBg: 'bg-white',
    ctaText: 'text-red-700',
    ctaHover: 'hover:bg-red-50',
    contactBg: 'bg-rose-700',
    contactText: 'text-white',
    cardBg: 'bg-red-50',
    sectionBg: 'bg-white',
  },
  slate: {
    heroBg: 'bg-gradient-to-br from-slate-700 to-slate-900',
    heroText: 'text-white',
    heroAccent: 'text-slate-300',
    ctaBg: 'bg-amber-400',
    ctaText: 'text-slate-900',
    ctaHover: 'hover:bg-amber-300',
    contactBg: 'bg-slate-800',
    contactText: 'text-white',
    cardBg: 'bg-slate-100',
    sectionBg: 'bg-white',
  },
  teal: {
    heroBg: 'bg-gradient-to-br from-teal-500 to-cyan-700',
    heroText: 'text-white',
    heroAccent: 'text-teal-100',
    ctaBg: 'bg-white',
    ctaText: 'text-teal-700',
    ctaHover: 'hover:bg-teal-50',
    contactBg: 'bg-teal-600',
    contactText: 'text-white',
    cardBg: 'bg-teal-50',
    sectionBg: 'bg-white',
  },
  earth: {
    heroBg: 'bg-gradient-to-br from-amber-700 to-stone-700',
    heroText: 'text-white',
    heroAccent: 'text-amber-200',
    ctaBg: 'bg-amber-400',
    ctaText: 'text-stone-900',
    ctaHover: 'hover:bg-amber-300',
    contactBg: 'bg-stone-700',
    contactText: 'text-white',
    cardBg: 'bg-stone-100',
    sectionBg: 'bg-white',
  },
};

const PALETTE_IDS = Object.keys(PALETTES);
const LAYOUTS: LayoutVariant[] = ['centered', 'split', 'minimal'];

const CATEGORY_PALETTES: Record<string, string[]> = {
  warm: ['sunset', 'crimson', 'earth'],
  clinical: ['teal', 'ocean', 'forest'],
  industrial: ['slate', 'earth', 'ocean'],
};

const CATEGORY_MAP: Record<string, string> = {
  restauracja: 'warm',
  piekarnia: 'warm',
  kwiaciarnia: 'warm',
  cukiernia: 'warm',
  kawiarnia: 'warm',
  dentysta: 'clinical',
  weterynarz: 'clinical',
  fizjoterapia: 'clinical',
  lekarz: 'clinical',
  apteka: 'clinical',
  mechanik: 'industrial',
  hydraulik: 'industrial',
  elektryk: 'industrial',
  warsztat: 'industrial',
};

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function pickPaletteId(slug: string, category: string): string {
  const cat = category.toLowerCase();
  const group = CATEGORY_MAP[cat];
  const pool = group ? CATEGORY_PALETTES[group] : PALETTE_IDS;
  return pool[hashStr(slug) % pool.length];
}

function pickLayout(slug: string): LayoutVariant {
  return LAYOUTS[hashStr(slug + '_layout') % LAYOUTS.length];
}

export function resolveTheme(slug: string, category: string): ThemeConfig {
  const id = pickPaletteId(slug, category);
  return {
    id,
    colors: PALETTES[id],
    layout: pickLayout(slug),
  };
}

export function getThemeById(id: string): ThemeColors | undefined {
  return PALETTES[id];
}
