/**
 * Import a tweakcn theme JSON into a PaletteVars file.
 * Usage: pnpm tsx scripts/add-tweakcn-theme.ts <tweakcn-json-url>
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface TweakcnCssVars {
  light: Record<string, string>;
  dark: Record<string, string>;
}

interface TweakcnTheme {
  name: string;
  cssVars: TweakcnCssVars;
}

const SHADCN_TO_LOCAL: Record<string, string> = {
  background: 'background',
  foreground: 'foreground',
  primary: 'primary',
  'primary-foreground': 'primary-foreground',
  secondary: 'secondary',
  'secondary-foreground': 'secondary-foreground',
  muted: 'muted',
  'muted-foreground': 'muted-foreground',
  accent: 'accent',
  'accent-foreground': 'accent-foreground',
  card: 'card',
  'card-foreground': 'card-foreground',
  border: 'border',
  ring: 'ring',
  radius: 'radius',
};

function mapVars(src: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(src)) {
    const mapped = SHADCN_TO_LOCAL[k];
    if (mapped) out[mapped] = v;
  }
  // derive hero tokens from primary if not present
  if (!out['hero'] && out['primary']) {
    out['hero'] = out['primary'];
    out['hero-end'] = out['primary'];
  }
  if (!out['hero-foreground'] && out['primary-foreground']) {
    out['hero-foreground'] = out['primary-foreground'];
  }
  if (!out['hero-accent'] && out['accent']) {
    out['hero-accent'] = out['accent'];
  }
  // pass through extra vars (font-family, letter-spacing, shadows)
  for (const [k, v] of Object.entries(src)) {
    if (!(k in SHADCN_TO_LOCAL) && !k.startsWith('chart-') && !k.startsWith('sidebar-')) {
      out[k] = v;
    }
  }
  return out;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: pnpm tsx scripts/add-tweakcn-theme.ts <tweakcn-json-url>');
    process.exit(1);
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${res.status}: ${await res.text()}`);
  const theme = (await res.json()) as TweakcnTheme;

  const name = slugify(theme.name || url.split('/').pop()!.replace('.json', ''));
  const light = mapVars(theme.cssVars.light);
  const dark = mapVars(theme.cssVars.dark);

  const fontFamily = theme.cssVars.light['font-family'] || theme.cssVars.light['font-sans'];

  const code = `import type { PaletteVars } from '../../lib/themes';

export const ${name.replace(/-/g, '_')}: PaletteVars = {
  light: ${JSON.stringify(light, null, 4)},
  dark: ${JSON.stringify(dark, null, 4)},
};

${fontFamily ? `export const fontFamily = ${JSON.stringify(fontFamily)};` : ''}
`;

  const outPath = resolve('src/styles/themes', `${name}.ts`);
  writeFileSync(outPath, code);
  console.log(`wrote ${outPath}`);
  if (fontFamily) {
    console.log(`font: ${fontFamily} — add Google Fonts <link> in BusinessSite.astro`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
