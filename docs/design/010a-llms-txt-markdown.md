# DD-010a: llms.txt + Markdown Routes dla AI Botow

## Przeglad

Serwujemy wizytowki w formacie markdown dla AI crawlerow/agentow. Dwa elementy:
1. `/llms.txt` — index wszystkich wygenerowanych wizytowek (standard [llmstxt.org](https://llmstxt.org))
2. `/[loc]/[slug].md` — markdown wizytowki z SiteData JSON (R2)

Bez `toMarkdown` API — mamy strukturalny JSON wiec templating jest prostszy, szybszy i darmowy.

## Cele / Nie-cele

**Cele:**
- `/llms.txt` endpoint z indexem biznesow
- `/[loc]/[slug].md` endpoint z markdown wizytowka
- Agresywny cache (edge 7d)
- Zero dodatkowych API calls (pure D1/R2 read)

**Nie-cele:**
- `llms-full.txt` (caly content inline — za duzy plik)
- Bot detection / User-Agent sniffing (explicit `.md` route zamiast)
- Content negotiation (`Accept: text/markdown`)
- `toMarkdown` conversion (niepotrzebne, mamy JSON)

---

## Implementacja

### 1. `/llms.txt` — Astro API Route

`src/pages/llms.txt.ts`

```ts
import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ locals }) => {
  const db = locals.runtime.env.leadgen as D1Database;

  const rows = await db.prepare(`
    SELECT b.title, b.slug, l.slug AS loc_slug, b.category, b.address
    FROM businesses b
    JOIN localities l ON b.locality_id = l.id
    WHERE b.site_generated = 1
    ORDER BY l.slug, b.slug
    LIMIT 10000
  `).all<{
    title: string;
    slug: string;
    loc_slug: string;
    category: string;
    address: string;
  }>();

  const lines = [
    '# wizytowka.link',
    '> Wizytowki polskich firm — strony wizytowkowe generowane automatycznie',
    '',
    '## Firmy',
    '',
  ];

  for (const r of rows.results) {
    lines.push(`- [${r.title}](https://wizytowka.link/${r.loc_slug}/${r.slug}.md): ${r.category}, ${r.address}`);
  }

  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, s-maxage=604800',
    },
  });
};
```

**Uwagi:**
- `LIMIT 10000` — safety cap. Jesli > 10k biznesow, rozwazyc paginacje lub R2 static file
- Sortowanie wg `loc_slug, slug` — deterministyczna kolejnosc
- 7d edge cache — odswieza sie rzadko, content dodawany codziennie
- Linkuje do `.md` (nie HTML) — AI boty dostaja markdown bezposrednio

### 2. `/[loc]/[slug].md` — Markdown Wizytowka

`src/pages/[loc]/[slug].md.ts`

```ts
import type { APIRoute } from 'astro';
import type { SiteData } from '../../types/site';

function siteToMarkdown(site: SiteData, title: string, url: string): string {
  const lines = [
    `# ${site.hero.headline}`,
    '',
    site.hero.subheadline,
    '',
    `## ${site.about.title}`,
    '',
    site.about.text,
    '',
    '## Uslugi',
    '',
  ];

  for (const s of site.services) {
    lines.push(`### ${s.name}`);
    lines.push('');
    lines.push(s.description);
    lines.push('');
  }

  lines.push('## Kontakt');
  lines.push('');
  lines.push(`- **Adres:** ${site.contact.address}`);
  lines.push(`- **Telefon:** ${site.contact.phone}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(`Zrodlo: [${title} — wizytowka.link](${url})`);

  return lines.join('\n');
}

export const GET: APIRoute = async ({ params, locals, url }) => {
  const { loc, slug } = params;
  if (!loc || !slug) return new Response(null, { status: 404 });

  const r2 = locals.runtime.env.sites as R2Bucket;
  const obj = await r2.get(`sites/${loc}/${slug}.json`);
  if (!obj) return new Response('Not Found', { status: 404 });

  const site = (await obj.json()) as SiteData;

  const db = locals.runtime.env.leadgen as D1Database;
  const biz = await db.prepare(
    `SELECT b.title FROM businesses b JOIN localities l ON b.locality_id = l.id WHERE l.slug = ? AND b.slug = ?`
  ).bind(loc, slug).first<{ title: string }>();

  const title = biz?.title ?? site.hero.headline;
  const canonical = `https://wizytowka.link/${loc}/${slug}`;
  const md = siteToMarkdown(site, title, canonical);

  return new Response(md, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, s-maxage=604800',
      'Link': `<${canonical}>; rel="canonical"`,
    },
  });
};
```

**Uwagi:**
- `siteToMarkdown` — pure function, zero deps, latwo testowalny
- `Link: <canonical>; rel="canonical"` — wskazuje na HTML wersje
- Ten sam cache co HTML route (7d edge)
- D1 query tylko po `title` — minimalne IO

### 3. `robots.txt` entry

Dodac do istniejacego `robots.txt` (lub stworzyc `src/pages/robots.txt.ts`):

```
Sitemap: https://wizytowka.link/llms.txt
```

### 4. Routing

Astro file-based routing automatycznie obsluguje:
- `/llms.txt` → `src/pages/llms.txt.ts`
- `/krakow/firma.md` → `src/pages/[loc]/[slug].md.ts`

Brak kolizji z istniejacym `[loc]/[slug].astro` (inny extension match).

---

## Przyklad output

### `/llms.txt`

```
# wizytowka.link
> Wizytowki polskich firm — strony wizytowkowe generowane automatycznie

## Firmy

- [Dental-Med](https://wizytowka.link/krakow/dental-med.md): dentysta, ul. Dluga 12, Krakow
- [Auto-Serwis Kowalski](https://wizytowka.link/warszawa/auto-serwis-kowalski.md): mechanik, ul. Polna 5, Warszawa
```

### `/krakow/dental-med.md`

```markdown
# Profesjonalna Opieka Stomatologiczna w Krakowie

Nowoczesny gabinet dentystyczny z wieloletnim doswiadczeniem

## O Nas

Dental-Med to gabinet stomatologiczny oferujacy kompleksowa opieke...

## Uslugi

### Stomatologia zachowawcza

Leczenie prochnicy, wypelnienia kompozytowe...

### Protetyka

Korony, mosty, protezy ruchome i stale...

## Kontakt

- **Adres:** ul. Dluga 12, 31-001 Krakow
- **Telefon:** +48 12 345 67 89

---

Zrodlo: [Dental-Med — wizytowka.link](https://wizytowka.link/krakow/dental-med)
```

---

## Skalowalnosc

| Biznesow | Rozmiar llms.txt | Strategia |
|----------|-----------------|-----------|
| < 10k   | ~1 MB           | D1 query + edge cache (obecna) |
| 10-50k  | ~5 MB           | Generacja do R2 via cron (po generator) |
| > 50k   | > 5 MB          | Paginacja: `/llms.txt?page=2` lub split per-voivodeship |

Na MVP wystarczy D1 query. Gdy > 10k biznesow, dodac cron step generujacy static file do R2.

---

## Weryfikacja

- [ ] `curl http://localhost:4321/llms.txt` → 200, `Content-Type: text/plain`
- [ ] llms.txt zawiera header `# wizytowka.link` + linie z linkami `.md`
- [ ] `curl http://localhost:4321/{loc}/{slug}.md` → 200, `Content-Type: text/markdown`
- [ ] Markdown zawiera hero headline, about, services, contact z SiteData JSON
- [ ] Brak R2 object → 404
- [ ] Brak params → 404
- [ ] `Cache-Control` header present na obu endpointach
- [ ] `Link` header z canonical URL na `.md` route
- [ ] `[loc]/[slug].astro` (HTML) nadal dziala bez zmian
- [ ] llms.txt linkuje do `.md` URLs (nie HTML)
- [ ] `robots.txt` zawiera `Sitemap: https://wizytowka.link/llms.txt`

---

## Referencje

- [llms.txt standard](https://llmstxt.org)
- [Cloudflare Workers AI toMarkdown](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/) (nie uzywany, ale fallback option)
- DD-005b: SSR Route (istniejacy HTML rendering)
- DD-005a: GLM-5 Generator (produkuje R2 JSON konsumowany tutaj)

## Decyzje

- **Bez `toMarkdown`** — mamy strukturalny JSON, direct templating prostsze i darmowe. `toMarkdown` bylby potrzebny gdybysmy serwowali markdown z arbitralnego HTML.
- **Bez content negotiation** — explicit `.md` extension zamiast `Accept` header. Prostsze, cacheable, debuggable.
- **Bez bot detection** — kazdy moze pobrac `.md`. Brak powodu do ograniczania.
- **`LIMIT 10000` na llms.txt** — safety cap. Revisit gdy > 10k generated sites.
- **`siteToMarkdown` jako pure function** — wydzielona do `src/lib/markdown.ts` jesli reuzywana, na razie inline w route.

## Rozwiazane pytania

- **`robots.txt` entry na `/llms.txt`?** — Tak. Dodac `Sitemap: https://wizytowka.link/llms.txt`. Zero kosztu, AI crawlery szukaja `llms.txt` automatycznie.
- **`<link rel="alternate" type="text/markdown">` w HTML?** — Nie. Zaden bot tego nie respektuje. Revisit gdy standard dojrzeje.
- **Max response size llms.txt?** — Nieistotne na MVP. < 10k biznesow = ~1MB, ok. `LIMIT 10000` jako safety cap. Revisit przy > 10k generated sites (split per-voivodeship lub paginacja).
