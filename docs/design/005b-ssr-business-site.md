# DD-005b: Astro SSR Route + BusinessSite Component

## Przeglad

SSR route renderuje strone wizytowkowa z JSON w R2 (wygenerowany przez DD-005a). Astro `[loc]/[slug].astro` pobiera dane z R2 + D1 (JSON-LD), `BusinessSite.astro` renderuje HTML z Tailwind.

## Cele / Nie-cele

**Cele:**
- SSR route `/[loc]/[slug]` serwujacy strone wizytowkowa
- JSON-LD LocalBusiness schema
- OG meta tags
- Mobile-first responsywny design (Tailwind)
- Edge cache 7d (`s-maxage=604800`)

**Nie-cele:**
- Generacja tresci (patrz DD-005a)
- Analityka odwiedzin
- Custom CSS (czyste Tailwind utilities)

---

## Implementacja

### `src/pages/[loc]/[slug].astro`

```astro
---
import BusinessSite from '../../components/BusinessSite.astro';
import type { SiteData } from '../../types/site';

const { loc, slug } = Astro.params;

if (!loc || !slug) return new Response(null, { status: 404 });

const r2 = Astro.locals.runtime.env.sites as R2Bucket;
const db = Astro.locals.runtime.env.leadgen as D1Database;
const obj = await r2.get(`sites/${loc}/${slug}.json`);

if (!obj) return new Response('Not Found', { status: 404 });

const site = (await obj.json()) as SiteData;

// business data for JSON-LD
const biz = await db.prepare(`
  SELECT b.title, b.phone, b.address, b.category, b.gps_lat, b.gps_lng, b.rating
  FROM businesses b
  JOIN localities l ON b.locality_id = l.id
  WHERE l.slug = ? AND b.slug = ?
`).bind(loc, slug).first<{
  title: string; phone: string; address: string; category: string;
  gps_lat: number; gps_lng: number; rating: number | null;
}>();

// 7d edge cache. Purge on regeneration: pnpm wrangler r2 object delete + CF cache purge API
// POST https://api.cloudflare.com/client/v4/zones/{zone_id}/purge_cache {"files":["url"]}
Astro.response.headers.set('Cache-Control', 'public, max-age=86400, s-maxage=604800');
---

<BusinessSite site={site} biz={biz} slug={slug} />
```

Key points:
- R2 get by `sites/{loc}/{slug}.json` — same key pattern as DD-005a upload
- D1 query for JSON-LD data (gps, rating, category)
- `slug` passed to BusinessSite for theme resolution (backwards compat w/ existing R2 JSONs)
- 404 if R2 object missing or params missing
- `Cache-Control: public, max-age=86400, s-maxage=604800` (1d browser, 7d edge)

### `src/components/BusinessSite.astro`

Parent component: resolves theme, renders `<head>` + JSON-LD, delegates `<body>` to layout.

```astro
---
import type { SiteData } from '../types/site';
import { resolveTheme, getThemeById } from '../lib/themes';
import CenteredLayout from './layouts/CenteredLayout.astro';
import SplitLayout from './layouts/SplitLayout.astro';
import MinimalLayout from './layouts/MinimalLayout.astro';

interface Props {
  site: SiteData;
  biz: BizData | null;
  slug: string;
}

const { site, biz, slug } = Astro.props;
const category = biz?.category ?? '';

// site.theme from R2 JSON (new sites) or slug-hash fallback (existing sites)
const themeConfig = site.theme
  ? { id: site.theme, colors: getThemeById(site.theme)!, layout: resolveTheme(slug, category).layout }
  : resolveTheme(slug, category);
const { colors, layout } = themeConfig;
---

<!-- <head> with SEO + JSON-LD stays here -->
<!-- <body> delegated to layout component based on layout variant -->
{layout === 'centered' && <CenteredLayout site={site} theme={colors} />}
{layout === 'split' && <SplitLayout site={site} theme={colors} />}
{layout === 'minimal' && <MinimalLayout site={site} theme={colors} />}
```

### Theme system (`src/lib/themes.ts`)

8 color palettes (Tailwind class bundles) + 3 layout variants, deterministic from slug hash.

**Palettes:** ocean, forest, sunset, royal, crimson, slate, teal, earth — each defines heroBg, heroText, heroAccent, ctaBg, ctaText, ctaHover, contactBg, contactText, cardBg, sectionBg.

**Category -> palette family** (soft bias):
- restauracja/piekarnia/kwiaciarnia/cukiernia/kawiarnia -> warm (sunset, crimson, earth)
- dentysta/weterynarz/fizjoterapia/lekarz/apteka -> clinical (teal, ocean, forest)
- mechanik/hydraulik/elektryk/warsztat -> industrial (slate, earth, ocean)
- Others -> any palette

**Selection:** `hash(slug) % pool.length` for palette, `hash(slug+'_layout') % 3` for layout. Deterministic — same slug always gets same theme.

### Layout components (`src/components/layouts/`)

Each receives `{ site: SiteData, theme: ThemeColors }` props. All render `<body>` with themed Tailwind classes.

- **CenteredLayout.astro** — full-width gradient hero, centered text, 3-col services grid (original layout)
- **SplitLayout.astro** — hero text left-aligned + CTA right, 2-col service cards, inline contact row
- **MinimalLayout.astro** — white hero w/ colored text (no gradient), list-style services, compact contact bar

Sections in all layouts: Hero (CTA `tel:` link), About, Services, Contact (`tel:` link), Footer.

### Backwards compatibility

Existing R2 JSONs lack `theme` field -> resolved at render time from `slug` hash. Same deterministic logic used at generation and render time. No R2 re-generation needed.

---

## Tailwind

Skonfigurowany w DD-001 (`@astrojs/tailwind` integration). Zero custom CSS, czyste utility classes.

All 8 palettes' Tailwind classes defined as string literals in `themes.ts` — content scanner picks them up at build time. No dynamic class construction (`bg-${color}-600` etc).

Breakpointy:
- default: mobile
- `md:` 768px
- `lg:` 1024px

---

## Weryfikacja

- [ ] `curl http://localhost:4321/stanislawow-pierwszy/firma-testowa` -> HTML 200
- [ ] HTML zawiera `<title>`, `<meta name="description">`, `<meta property="og:title">`, `<meta property="og:url">`
- [ ] `<script type="application/ld+json">` present z LocalBusiness schema
- [ ] `<a href="tel:...">` obecny w hero i contact sections
- [ ] Mobile: Chrome DevTools responsive -> bez horizontal scroll, czytelne na 375px
- [ ] Grid: 1 col mobile, 2 col `md:`, 3 col `lg:` (centered layout)
- [ ] Compare 3+ sites — different colors + layouts visible
- [ ] Same slug always renders same theme (deterministic)
- [ ] Existing R2 JSON without `theme` field -> page renders with slug-hash theme (no crash)
- [ ] Missing R2 object -> 404 response
- [ ] Missing URL params -> 404 response
- [ ] `Cache-Control` header present: `public, max-age=86400, s-maxage=604800`
- [ ] `biz = null` (D1 miss) -> page renders without JSON-LD (no crash)

---

## Referencje

- [Astro dynamic routes](https://docs.astro.build/en/guides/routing/#dynamic-routes)
- [Astro CF bindings](https://docs.astro.build/en/guides/integrations-guide/cloudflare/#cloudflare-runtime)
- [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
- DD-005a: GLM-5 generator (produces R2 JSON consumed here)
- DD-001: Scaffold/Infrastructure (Tailwind config)
- PLAN.md: etap 5

## Decyzje

- **Cache R2 w KV** — nie. R2 GET wystarczajaco szybki na MVP traffic.
- **Google Maps embed** — nie. Wymaga API key + koszt. Statyczny adres wystarczy.
- **Cache purge** — manual via CF API: `POST /zones/{zone_id}/purge_cache {"files":["url"]}`.
- **`biz` null safety** — JSON-LD skipped if D1 query returns null. Page still renders.
- **Theme system** — 8 color palettes + 3 layout variants, deterministic from slug hash. Category biases palette family. Stored in R2 JSON (`theme` field) for new sites; fallback to slug-hash for existing. No D1 migration needed.
- **Layout delegation** — `BusinessSite.astro` keeps `<head>` + JSON-LD, delegates `<body>` to `CenteredLayout`/`SplitLayout`/`MinimalLayout`.
