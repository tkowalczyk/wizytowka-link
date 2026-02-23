export type LayoutVariant = 'centered' | 'split' | 'minimal';
export type StyleVariant = 'modern' | 'elegant' | 'bold';

export interface PaletteVars {
  light: Record<string, string>;
  dark: Record<string, string>;
}

export interface ThemeConfig {
  paletteId: string;
  palette: PaletteVars;
  layout: LayoutVariant;
  style: StyleVariant;
}

/* ── oklch palettes ── */
const PALETTES: Record<string, PaletteVars> = {
  ocean: {
    light: {
      background: 'oklch(0.98 0.01 240)',
      foreground: 'oklch(0.15 0.02 240)',
      primary: 'oklch(0.50 0.18 250)',
      'primary-foreground': 'oklch(0.98 0.01 240)',
      secondary: 'oklch(0.93 0.03 240)',
      'secondary-foreground': 'oklch(0.25 0.04 240)',
      muted: 'oklch(0.94 0.02 240)',
      'muted-foreground': 'oklch(0.50 0.03 240)',
      accent: 'oklch(0.95 0.04 200)',
      'accent-foreground': 'oklch(0.25 0.06 240)',
      card: 'oklch(0.99 0.005 240)',
      'card-foreground': 'oklch(0.15 0.02 240)',
      border: 'oklch(0.90 0.02 240)',
      ring: 'oklch(0.50 0.18 250)',
      hero: 'oklch(0.50 0.18 250)',
      'hero-end': 'oklch(0.38 0.15 255)',
      'hero-foreground': 'oklch(0.98 0.01 240)',
      'hero-accent': 'oklch(0.85 0.06 240)',
      radius: '0.5rem',
    },
    dark: {
      background: 'oklch(0.15 0.02 240)',
      foreground: 'oklch(0.93 0.01 240)',
      primary: 'oklch(0.60 0.18 250)',
      'primary-foreground': 'oklch(0.12 0.02 240)',
      secondary: 'oklch(0.22 0.03 240)',
      'secondary-foreground': 'oklch(0.90 0.02 240)',
      muted: 'oklch(0.22 0.02 240)',
      'muted-foreground': 'oklch(0.65 0.03 240)',
      accent: 'oklch(0.28 0.05 200)',
      'accent-foreground': 'oklch(0.90 0.03 200)',
      card: 'oklch(0.18 0.02 240)',
      'card-foreground': 'oklch(0.93 0.01 240)',
      border: 'oklch(0.28 0.02 240)',
      ring: 'oklch(0.60 0.18 250)',
      hero: 'oklch(0.38 0.16 250)',
      'hero-end': 'oklch(0.28 0.12 255)',
      'hero-foreground': 'oklch(0.95 0.01 240)',
      'hero-accent': 'oklch(0.75 0.06 240)',
      radius: '0.5rem',
    },
  },
  forest: {
    light: {
      background: 'oklch(0.98 0.01 155)',
      foreground: 'oklch(0.15 0.03 155)',
      primary: 'oklch(0.52 0.17 160)',
      'primary-foreground': 'oklch(0.98 0.01 155)',
      secondary: 'oklch(0.93 0.04 155)',
      'secondary-foreground': 'oklch(0.25 0.05 155)',
      muted: 'oklch(0.94 0.03 155)',
      'muted-foreground': 'oklch(0.50 0.04 155)',
      accent: 'oklch(0.92 0.06 155)',
      'accent-foreground': 'oklch(0.25 0.06 155)',
      card: 'oklch(0.99 0.005 155)',
      'card-foreground': 'oklch(0.15 0.03 155)',
      border: 'oklch(0.90 0.03 155)',
      ring: 'oklch(0.52 0.17 160)',
      hero: 'oklch(0.52 0.17 160)',
      'hero-end': 'oklch(0.40 0.13 165)',
      'hero-foreground': 'oklch(0.98 0.01 155)',
      'hero-accent': 'oklch(0.85 0.06 155)',
      radius: '0.5rem',
    },
    dark: {
      background: 'oklch(0.15 0.02 155)',
      foreground: 'oklch(0.93 0.01 155)',
      primary: 'oklch(0.60 0.17 160)',
      'primary-foreground': 'oklch(0.12 0.02 155)',
      secondary: 'oklch(0.22 0.03 155)',
      'secondary-foreground': 'oklch(0.90 0.02 155)',
      muted: 'oklch(0.22 0.02 155)',
      'muted-foreground': 'oklch(0.65 0.03 155)',
      accent: 'oklch(0.28 0.06 155)',
      'accent-foreground': 'oklch(0.90 0.04 155)',
      card: 'oklch(0.18 0.02 155)',
      'card-foreground': 'oklch(0.93 0.01 155)',
      border: 'oklch(0.28 0.02 155)',
      ring: 'oklch(0.60 0.17 160)',
      hero: 'oklch(0.40 0.14 160)',
      'hero-end': 'oklch(0.30 0.10 165)',
      'hero-foreground': 'oklch(0.95 0.01 155)',
      'hero-accent': 'oklch(0.75 0.06 155)',
      radius: '0.5rem',
    },
  },
  sunset: {
    light: {
      background: 'oklch(0.98 0.01 70)',
      foreground: 'oklch(0.15 0.03 50)',
      primary: 'oklch(0.70 0.18 65)',
      'primary-foreground': 'oklch(0.98 0.01 70)',
      secondary: 'oklch(0.93 0.04 60)',
      'secondary-foreground': 'oklch(0.30 0.06 50)',
      muted: 'oklch(0.94 0.03 60)',
      'muted-foreground': 'oklch(0.50 0.04 50)',
      accent: 'oklch(0.92 0.08 60)',
      'accent-foreground': 'oklch(0.25 0.06 50)',
      card: 'oklch(0.99 0.005 60)',
      'card-foreground': 'oklch(0.15 0.03 50)',
      border: 'oklch(0.90 0.03 60)',
      ring: 'oklch(0.70 0.18 65)',
      hero: 'oklch(0.72 0.17 70)',
      'hero-end': 'oklch(0.60 0.19 45)',
      'hero-foreground': 'oklch(0.98 0.01 70)',
      'hero-accent': 'oklch(0.88 0.06 70)',
      radius: '0.5rem',
    },
    dark: {
      background: 'oklch(0.15 0.02 50)',
      foreground: 'oklch(0.93 0.01 60)',
      primary: 'oklch(0.72 0.16 65)',
      'primary-foreground': 'oklch(0.12 0.03 50)',
      secondary: 'oklch(0.22 0.04 50)',
      'secondary-foreground': 'oklch(0.90 0.02 60)',
      muted: 'oklch(0.22 0.03 50)',
      'muted-foreground': 'oklch(0.65 0.04 50)',
      accent: 'oklch(0.30 0.08 60)',
      'accent-foreground': 'oklch(0.90 0.05 60)',
      card: 'oklch(0.18 0.02 50)',
      'card-foreground': 'oklch(0.93 0.01 60)',
      border: 'oklch(0.28 0.03 50)',
      ring: 'oklch(0.72 0.16 65)',
      hero: 'oklch(0.55 0.15 70)',
      'hero-end': 'oklch(0.42 0.16 45)',
      'hero-foreground': 'oklch(0.95 0.01 60)',
      'hero-accent': 'oklch(0.78 0.06 70)',
      radius: '0.5rem',
    },
  },
  royal: {
    light: {
      background: 'oklch(0.98 0.01 290)',
      foreground: 'oklch(0.15 0.03 280)',
      primary: 'oklch(0.48 0.18 290)',
      'primary-foreground': 'oklch(0.98 0.01 290)',
      secondary: 'oklch(0.93 0.04 290)',
      'secondary-foreground': 'oklch(0.25 0.06 280)',
      muted: 'oklch(0.94 0.03 290)',
      'muted-foreground': 'oklch(0.50 0.04 280)',
      accent: 'oklch(0.92 0.06 290)',
      'accent-foreground': 'oklch(0.25 0.06 280)',
      card: 'oklch(0.99 0.005 290)',
      'card-foreground': 'oklch(0.15 0.03 280)',
      border: 'oklch(0.90 0.03 290)',
      ring: 'oklch(0.48 0.18 290)',
      hero: 'oklch(0.48 0.18 290)',
      'hero-end': 'oklch(0.38 0.16 270)',
      'hero-foreground': 'oklch(0.98 0.01 290)',
      'hero-accent': 'oklch(0.82 0.08 290)',
      radius: '0.5rem',
    },
    dark: {
      background: 'oklch(0.15 0.03 280)',
      foreground: 'oklch(0.93 0.01 290)',
      primary: 'oklch(0.58 0.18 290)',
      'primary-foreground': 'oklch(0.12 0.03 280)',
      secondary: 'oklch(0.22 0.04 280)',
      'secondary-foreground': 'oklch(0.90 0.02 290)',
      muted: 'oklch(0.22 0.03 280)',
      'muted-foreground': 'oklch(0.65 0.04 280)',
      accent: 'oklch(0.28 0.06 290)',
      'accent-foreground': 'oklch(0.90 0.04 290)',
      card: 'oklch(0.18 0.03 280)',
      'card-foreground': 'oklch(0.93 0.01 290)',
      border: 'oklch(0.28 0.03 280)',
      ring: 'oklch(0.58 0.18 290)',
      hero: 'oklch(0.38 0.16 290)',
      'hero-end': 'oklch(0.28 0.14 270)',
      'hero-foreground': 'oklch(0.95 0.01 290)',
      'hero-accent': 'oklch(0.72 0.08 290)',
      radius: '0.5rem',
    },
  },
  crimson: {
    light: {
      background: 'oklch(0.98 0.01 15)',
      foreground: 'oklch(0.15 0.03 15)',
      primary: 'oklch(0.52 0.20 25)',
      'primary-foreground': 'oklch(0.98 0.01 15)',
      secondary: 'oklch(0.93 0.04 15)',
      'secondary-foreground': 'oklch(0.25 0.05 15)',
      muted: 'oklch(0.94 0.02 15)',
      'muted-foreground': 'oklch(0.50 0.03 15)',
      accent: 'oklch(0.92 0.06 15)',
      'accent-foreground': 'oklch(0.25 0.06 15)',
      card: 'oklch(0.99 0.005 15)',
      'card-foreground': 'oklch(0.15 0.03 15)',
      border: 'oklch(0.90 0.02 15)',
      ring: 'oklch(0.52 0.20 25)',
      hero: 'oklch(0.52 0.20 25)',
      'hero-end': 'oklch(0.42 0.17 350)',
      'hero-foreground': 'oklch(0.98 0.01 15)',
      'hero-accent': 'oklch(0.85 0.06 15)',
      radius: '0.5rem',
    },
    dark: {
      background: 'oklch(0.15 0.02 15)',
      foreground: 'oklch(0.93 0.01 15)',
      primary: 'oklch(0.60 0.20 25)',
      'primary-foreground': 'oklch(0.12 0.02 15)',
      secondary: 'oklch(0.22 0.03 15)',
      'secondary-foreground': 'oklch(0.90 0.02 15)',
      muted: 'oklch(0.22 0.02 15)',
      'muted-foreground': 'oklch(0.65 0.03 15)',
      accent: 'oklch(0.28 0.06 15)',
      'accent-foreground': 'oklch(0.90 0.04 15)',
      card: 'oklch(0.18 0.02 15)',
      'card-foreground': 'oklch(0.93 0.01 15)',
      border: 'oklch(0.28 0.02 15)',
      ring: 'oklch(0.60 0.20 25)',
      hero: 'oklch(0.42 0.18 25)',
      'hero-end': 'oklch(0.32 0.15 350)',
      'hero-foreground': 'oklch(0.95 0.01 15)',
      'hero-accent': 'oklch(0.75 0.06 15)',
      radius: '0.5rem',
    },
  },
  slate: {
    light: {
      background: 'oklch(0.98 0.005 260)',
      foreground: 'oklch(0.15 0.01 260)',
      primary: 'oklch(0.35 0.02 260)',
      'primary-foreground': 'oklch(0.98 0.005 260)',
      secondary: 'oklch(0.93 0.01 260)',
      'secondary-foreground': 'oklch(0.25 0.015 260)',
      muted: 'oklch(0.94 0.008 260)',
      'muted-foreground': 'oklch(0.50 0.015 260)',
      accent: 'oklch(0.82 0.14 85)',
      'accent-foreground': 'oklch(0.20 0.02 260)',
      card: 'oklch(0.99 0.003 260)',
      'card-foreground': 'oklch(0.15 0.01 260)',
      border: 'oklch(0.90 0.008 260)',
      ring: 'oklch(0.35 0.02 260)',
      hero: 'oklch(0.35 0.02 260)',
      'hero-end': 'oklch(0.22 0.015 260)',
      'hero-foreground': 'oklch(0.98 0.005 260)',
      'hero-accent': 'oklch(0.75 0.01 260)',
      radius: '0.5rem',
    },
    dark: {
      background: 'oklch(0.15 0.01 260)',
      foreground: 'oklch(0.93 0.005 260)',
      primary: 'oklch(0.55 0.02 260)',
      'primary-foreground': 'oklch(0.12 0.01 260)',
      secondary: 'oklch(0.22 0.01 260)',
      'secondary-foreground': 'oklch(0.90 0.005 260)',
      muted: 'oklch(0.22 0.008 260)',
      'muted-foreground': 'oklch(0.65 0.01 260)',
      accent: 'oklch(0.75 0.12 85)',
      'accent-foreground': 'oklch(0.15 0.02 260)',
      card: 'oklch(0.18 0.01 260)',
      'card-foreground': 'oklch(0.93 0.005 260)',
      border: 'oklch(0.28 0.008 260)',
      ring: 'oklch(0.55 0.02 260)',
      hero: 'oklch(0.28 0.015 260)',
      'hero-end': 'oklch(0.18 0.01 260)',
      'hero-foreground': 'oklch(0.95 0.005 260)',
      'hero-accent': 'oklch(0.70 0.01 260)',
      radius: '0.5rem',
    },
  },
  teal: {
    light: {
      background: 'oklch(0.98 0.01 185)',
      foreground: 'oklch(0.15 0.02 185)',
      primary: 'oklch(0.60 0.14 185)',
      'primary-foreground': 'oklch(0.98 0.01 185)',
      secondary: 'oklch(0.93 0.03 185)',
      'secondary-foreground': 'oklch(0.25 0.04 185)',
      muted: 'oklch(0.94 0.02 185)',
      'muted-foreground': 'oklch(0.50 0.03 185)',
      accent: 'oklch(0.92 0.05 185)',
      'accent-foreground': 'oklch(0.25 0.05 185)',
      card: 'oklch(0.99 0.005 185)',
      'card-foreground': 'oklch(0.15 0.02 185)',
      border: 'oklch(0.90 0.02 185)',
      ring: 'oklch(0.60 0.14 185)',
      hero: 'oklch(0.60 0.14 185)',
      'hero-end': 'oklch(0.48 0.12 210)',
      'hero-foreground': 'oklch(0.98 0.01 185)',
      'hero-accent': 'oklch(0.85 0.05 185)',
      radius: '0.5rem',
    },
    dark: {
      background: 'oklch(0.15 0.02 185)',
      foreground: 'oklch(0.93 0.01 185)',
      primary: 'oklch(0.65 0.14 185)',
      'primary-foreground': 'oklch(0.12 0.02 185)',
      secondary: 'oklch(0.22 0.03 185)',
      'secondary-foreground': 'oklch(0.90 0.02 185)',
      muted: 'oklch(0.22 0.02 185)',
      'muted-foreground': 'oklch(0.65 0.03 185)',
      accent: 'oklch(0.28 0.05 185)',
      'accent-foreground': 'oklch(0.90 0.04 185)',
      card: 'oklch(0.18 0.02 185)',
      'card-foreground': 'oklch(0.93 0.01 185)',
      border: 'oklch(0.28 0.02 185)',
      ring: 'oklch(0.65 0.14 185)',
      hero: 'oklch(0.48 0.12 185)',
      'hero-end': 'oklch(0.38 0.10 210)',
      'hero-foreground': 'oklch(0.95 0.01 185)',
      'hero-accent': 'oklch(0.75 0.05 185)',
      radius: '0.5rem',
    },
  },
  earth: {
    light: {
      background: 'oklch(0.97 0.01 70)',
      foreground: 'oklch(0.18 0.02 50)',
      primary: 'oklch(0.50 0.10 55)',
      'primary-foreground': 'oklch(0.97 0.01 70)',
      secondary: 'oklch(0.92 0.03 60)',
      'secondary-foreground': 'oklch(0.28 0.04 50)',
      muted: 'oklch(0.93 0.02 60)',
      'muted-foreground': 'oklch(0.50 0.03 50)',
      accent: 'oklch(0.80 0.12 85)',
      'accent-foreground': 'oklch(0.20 0.03 50)',
      card: 'oklch(0.98 0.005 60)',
      'card-foreground': 'oklch(0.18 0.02 50)',
      border: 'oklch(0.88 0.02 60)',
      ring: 'oklch(0.50 0.10 55)',
      hero: 'oklch(0.55 0.10 70)',
      'hero-end': 'oklch(0.42 0.06 50)',
      'hero-foreground': 'oklch(0.97 0.01 70)',
      'hero-accent': 'oklch(0.82 0.06 70)',
      radius: '0.5rem',
    },
    dark: {
      background: 'oklch(0.15 0.01 50)',
      foreground: 'oklch(0.92 0.01 60)',
      primary: 'oklch(0.58 0.10 55)',
      'primary-foreground': 'oklch(0.12 0.01 50)',
      secondary: 'oklch(0.22 0.02 50)',
      'secondary-foreground': 'oklch(0.90 0.01 60)',
      muted: 'oklch(0.22 0.015 50)',
      'muted-foreground': 'oklch(0.65 0.02 50)',
      accent: 'oklch(0.70 0.10 85)',
      'accent-foreground': 'oklch(0.15 0.02 50)',
      card: 'oklch(0.18 0.01 50)',
      'card-foreground': 'oklch(0.92 0.01 60)',
      border: 'oklch(0.28 0.015 50)',
      ring: 'oklch(0.58 0.10 55)',
      hero: 'oklch(0.42 0.08 70)',
      'hero-end': 'oklch(0.30 0.05 50)',
      'hero-foreground': 'oklch(0.95 0.01 60)',
      'hero-accent': 'oklch(0.72 0.06 70)',
      radius: '0.5rem',
    },
  },
};

const PALETTE_IDS = Object.keys(PALETTES);
const LAYOUTS: LayoutVariant[] = ['centered', 'split', 'minimal'];
const STYLES: StyleVariant[] = ['modern', 'elegant', 'bold'];

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

function pickStyle(slug: string): StyleVariant {
  return STYLES[hashStr(slug + '_style') % STYLES.length];
}

export function paletteToCSS(vars: PaletteVars): string {
  const lightVars = Object.entries(vars.light)
    .map(([k, v]) => `--${k}:${v}`)
    .join(';');
  const darkVars = Object.entries(vars.dark)
    .map(([k, v]) => `--${k}:${v}`)
    .join(';');
  return `:root{${lightVars}}.dark{${darkVars}}`;
}

export function resolveTheme(slug: string, category: string): ThemeConfig {
  const paletteId = pickPaletteId(slug, category);
  return {
    paletteId,
    palette: PALETTES[paletteId],
    layout: pickLayout(slug),
    style: pickStyle(slug),
  };
}

export function getPaletteById(id: string): PaletteVars | undefined {
  return PALETTES[id];
}
