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
- Niestandardowe szablony per-kategoria
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

<BusinessSite site={site} biz={biz} />
```

Key points:
- R2 get by `sites/{loc}/{slug}.json` — same key pattern as DD-005a upload
- D1 query for JSON-LD data (gps, rating, category)
- 404 if R2 object missing or params missing
- `Cache-Control: public, max-age=86400, s-maxage=604800` (1d browser, 7d edge)

### `src/components/BusinessSite.astro`

```astro
---
import type { SiteData } from '../types/site';

interface BizData {
  title: string;
  phone: string;
  address: string;
  category: string;
  gps_lat: number;
  gps_lng: number;
  rating: number | null;
}

interface Props {
  site: SiteData;
  biz: BizData | null;
}

const { site, biz } = Astro.props;

const jsonLd = biz ? JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'LocalBusiness',
  name: biz.title,
  telephone: biz.phone,
  address: { '@type': 'PostalAddress', streetAddress: biz.address },
  geo: { '@type': 'GeoCoordinates', latitude: biz.gps_lat, longitude: biz.gps_lng },
  ...(biz.rating ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: biz.rating, bestRating: 5, reviewCount: 1 } } : {}),
  url: Astro.url.href,
}) : null;
---

<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{site.seo.title}</title>
  <meta name="description" content={site.seo.description} />
  <meta name="robots" content="index, follow" />
  <link rel="canonical" href={Astro.url.href} />

  <!-- OG -->
  <meta property="og:title" content={site.seo.title} />
  <meta property="og:description" content={site.seo.description} />
  <meta property="og:type" content="website" />
  <meta property="og:url" content={Astro.url.href} />

  <!-- JSON-LD -->
  {jsonLd && <script type="application/ld+json" set:html={jsonLd} />}
</head>

<body class="bg-gray-50 text-gray-900 font-sans antialiased">

  <!-- Hero -->
  <section class="bg-gradient-to-br from-blue-600 to-blue-800 text-white py-20 px-4">
    <div class="max-w-3xl mx-auto text-center">
      <h1 class="text-4xl md:text-5xl font-bold mb-4">{site.hero.headline}</h1>
      <p class="text-xl md:text-2xl text-blue-100 mb-8">{site.hero.subheadline}</p>
      <a
        href={`tel:${site.contact.phone}`}
        class="inline-block bg-white text-blue-700 font-semibold px-8 py-3 rounded-lg
               hover:bg-blue-50 transition-colors text-lg"
      >
        {site.contact.cta_text}
      </a>
    </div>
  </section>

  <!-- About -->
  <section class="py-16 px-4">
    <div class="max-w-3xl mx-auto">
      <h2 class="text-3xl font-bold mb-4">{site.about.title}</h2>
      <p class="text-lg text-gray-600 leading-relaxed">{site.about.text}</p>
    </div>
  </section>

  <!-- Services -->
  <section class="bg-white py-16 px-4">
    <div class="max-w-5xl mx-auto">
      <h2 class="text-3xl font-bold text-center mb-12">Uslugi</h2>
      <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {site.services.map((s) => (
          <div class="bg-gray-50 rounded-xl p-6">
            <h3 class="text-xl font-semibold mb-2">{s.name}</h3>
            <p class="text-gray-600">{s.description}</p>
          </div>
        ))}
      </div>
    </div>
  </section>

  <!-- Contact -->
  <section class="bg-blue-600 text-white py-16 px-4">
    <div class="max-w-3xl mx-auto text-center">
      <h2 class="text-3xl font-bold mb-4">Kontakt</h2>
      <p class="text-lg mb-2">{site.contact.address}</p>
      <a
        href={`tel:${site.contact.phone}`}
        class="inline-block bg-white text-blue-700 font-semibold px-8 py-3
               rounded-lg hover:bg-blue-50 transition-colors text-lg mt-4"
      >
        {site.contact.phone}
      </a>
    </div>
  </section>

  <!-- Footer -->
  <footer class="py-6 text-center text-sm text-gray-400">
    <p>Strona wygenerowana przez <a href="https://wizytowka.link" class="underline">wizytowka.link</a></p>
  </footer>

</body>
</html>
```

Sections: Hero (CTA `tel:` link), About, Services (grid 1/2/3 col), Contact (`tel:` link), Footer.

---

## Tailwind

Skonfigurowany w DD-001 (`@astrojs/tailwind` integration). Zero custom CSS, czyste utility classes.

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
- [ ] Grid: 1 col mobile, 2 col `md:`, 3 col `lg:`
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
