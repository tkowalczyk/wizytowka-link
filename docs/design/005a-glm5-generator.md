# DD-005a: GLM-5 Content Generator + R2 Storage

## Przeglad

GLM-5 generuje JSON tresci strony wizytowkowej per firma bez www. Walidacja + zapis do R2. Stage niezalezny od SSR (005b).

Flow: D1 query (firmy bez www, `site_generated=0`) -> GLM-5 prompt -> walidacja JSON -> R2 upload -> mark `site_generated=1`.

## Cele / Nie-cele

**Cele:**
- GLM-5 generuje tresc strony (JSON) per firma
- Walidacja struktury JSON
- Zapis do R2 (`sites/{loc_slug}/{biz_slug}.json`)
- Mark `site_generated=1` w D1 po sukcesie

**Nie-cele:**
- SSR render (patrz DD-005b)
- Edycja tresci przez sprzedawce
- Retry/queue per firma (skip on fail, retry w nastepnym cron run)

---

## Typy

### `src/types/site.ts`

```ts
interface SiteHero {
  headline: string;
  subheadline: string;
}

interface SiteAbout {
  title: string;
  text: string;
}

interface SiteService {
  name: string;
  description: string;
}

interface SiteContact {
  cta_text: string;
  phone: string;
  address: string;
}

interface SiteSeo {
  title: string;
  description: string;
}

interface SiteData {
  hero: SiteHero;
  about: SiteAbout;
  services: SiteService[];
  contact: SiteContact;
  seo: SiteSeo;
}
```

### `src/lib/generator.ts` — internal types

```ts
interface BusinessRow {
  id: number;
  title: string;
  category: string;
  address: string;
  phone: string;
  rating: number | null;
  slug: string;
  locality_name: string;
  loc_slug: string;
}

interface GLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface GLMChoice {
  message: { content: string };
}

interface GLMResponse {
  choices: GLMChoice[];
}
```

---

## Implementacja: `src/lib/generator.ts`

```ts
import type { SiteData, SiteService } from '../types/site';

// types: BusinessRow, GLMMessage, GLMChoice, GLMResponse (see above)

// Use wrangler-generated Env from worker-configuration.d.ts — do NOT redefine locally

const SYSTEM_PROMPT = `Jestes ekspertem od marketingu lokalnych firm w Polsce. Generujesz tresc strony wizytowkowej w formacie JSON.`;

function buildUserPrompt(biz: BusinessRow): string {
  return `Wygeneruj JSON strony wizytowkowej dla firmy:
- Nazwa: ${biz.title}
- Kategoria: ${biz.category}
- Adres: ${biz.address}
- Telefon: ${biz.phone}
- Ocena Google: ${biz.rating != null ? `${biz.rating}/5` : 'brak'}

Format JSON:
{
  "hero": { "headline": "...", "subheadline": "..." },
  "about": { "title": "...", "text": "..." },
  "services": [{ "name": "...", "description": "..." }],
  "contact": { "cta_text": "...", "phone": "...", "address": "..." },
  "seo": { "title": "...", "description": "..." }
}

Zasady:
- Pisz po polsku, naturalnie, bez marketingowego bullshitu
- 3-5 uslug dopasowanych do kategorii
- SEO title max 60 znakow, description max 155
- Odpowiedz TYLKO JSON, bez markdown`;
}

async function callGLM5(
  messages: GLMMessage[],
  apiKey: string
): Promise<string> {
  // TODO: verify endpoint URL before first use — may change
  const res = await fetch('https://api.z.ai/api/paas/v4/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'glm-5',
      messages,
      temperature: 0.7,
      max_tokens: 2000,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GLM-5 ${res.status}: ${text}`);
  }

  const data = (await res.json()) as GLMResponse;
  return data.choices[0].message.content;
}

function isStr(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function validateSiteData(raw: string): SiteData {
  const cleaned = raw.replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim();
  const p = JSON.parse(cleaned);

  if (typeof p !== 'object' || p === null) throw new Error('not an object');

  const hero = p.hero;
  if (!hero || !isStr(hero.headline) || !isStr(hero.subheadline))
    throw new Error('invalid hero');

  const about = p.about;
  if (!about || !isStr(about.title) || !isStr(about.text))
    throw new Error('invalid about');

  const services = p.services;
  if (!Array.isArray(services) || services.length < 1)
    throw new Error('invalid services');
  for (const s of services) {
    if (!isStr(s.name) || !isStr(s.description))
      throw new Error('invalid service item');
  }

  const contact = p.contact;
  if (!contact || !isStr(contact.cta_text) || !isStr(contact.phone))
    throw new Error('invalid contact');
  if (!isStr(contact.address)) contact.address = '';

  const seo = p.seo;
  if (!seo || !isStr(seo.title) || !isStr(seo.description))
    throw new Error('invalid seo');
  if (seo.title.length > 60) seo.title = seo.title.slice(0, 60);
  if (seo.description.length > 155) seo.description = seo.description.slice(0, 155);

  return { hero, about, services, contact, seo };
}

// slugify z src/lib/slug.ts (kanoniczna implementacja, patrz DD-004)
import { slugify } from './slug';

export async function generateSites(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(`
    SELECT b.*, l.name as locality_name, l.slug as loc_slug
    FROM businesses b
    JOIN localities l ON b.locality_id = l.id
    WHERE b.website IS NULL AND b.phone IS NOT NULL AND b.site_generated = 0
    LIMIT 10
  `).all<BusinessRow>();

  if (!results?.length) return;

  for (const biz of results) {
    try {
      const messages: GLMMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(biz) },
      ];

      const raw = await callGLM5(messages, env.ZAI_API_KEY);
      const siteData = validateSiteData(raw);

      const key = `sites/${biz.loc_slug}/${biz.slug}.json`;

      await env.R2.put(key, JSON.stringify(siteData), {
        httpMetadata: { contentType: 'application/json' },
      });

      await env.DB.prepare(
        `UPDATE businesses SET site_generated = 1 WHERE id = ?`
      ).bind(biz.id).run();

      console.log(`generated: ${key}`);
    } catch (err) {
      console.error(`fail biz ${biz.id}: ${(err as Error).message}`);
    }
  }
}
```

### R2 key pattern

```
sites/{loc_slug}/{biz_slug}.json
```

---

## Integracja z cron

Zintegrowane w DD-001a `src/worker.ts` — cron `0 8 * * *` uruchamia `scrapeBusinesses(env)` a nastepnie `generateSites(env)` sekwencyjnie.

---

## Env / Secrets

W `.production.vars`:
```
ZAI_API_KEY=...
```

Binding w `wrangler.jsonc`:
```jsonc
{
  "r2_buckets": [{ "binding": "R2", "bucket_name": "sites" }]
}
```

---

## Obsluga bledow

| Blad | Obsluga |
|---|---|
| GLM-5 timeout/5xx | `console.error`, skip firma, retry w nastepnym runie |
| Niepoprawny JSON z LLM | `validateSiteData` rzuca, skip firma |
| R2 put fail | catch, log, nie aktualizuj `site_generated` |
| GLM-5 429 rate limit | catch, stop batch |

Generator przetwarza 10 firm/run. Failures nie blokuja reszty batcha — `try/catch` per firma.

---

## Weryfikacja

- [ ] `ZAI_API_KEY` ustawiony w `.production.vars`
- [ ] Uruchom generator dla testowej firmy -> log `generated: sites/...`
- [ ] `wrangler r2 object get sites/sites/stanislawow-pierwszy/firma-testowa.json` -> valid JSON ze wszystkimi polami
- [ ] Wszystkie pola obecne: hero, about, services (3-5), contact, seo
- [ ] SEO title <= 60 znakow, description <= 155
- [ ] `SELECT site_generated, slug FROM businesses WHERE id = ?` -> `1`
- [ ] Firma z `rating IS NULL` -> generator nie crashuje, prompt pokazuje "brak"

---

## Referencje

- [Z.AI API Quick Start](https://docs.z.ai/guides/overview/quick-start)
- [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
- DD-001a: Scaffold/Infrastructure (cron integration)
- DD-004: Scraper (etap 4, `slugify()`, `BusinessRow`)
- DD-005b: SSR route (konsumuje R2 JSON)
- PLAN.md: etap 5

## Decyzje

- **Retry GLM-5** — brak. Skip on fail, `site_generated` stays 0, retry w nastepnym runie.
- **Rate limit GLM-5** — nieudokumentowany. 10 firm/run jest konserwatywne. Jesli 429 -> catch, stop batch.
- **Batch >10** — raz dziennie po scraperze (ten sam cron `0 8 * * *`). 10/run, backlog znika w kilka dni.
- **Slug collision** — obsluzony w DD-004: `UNIQUE(slug, locality_id)` + suffix `-2`, `-3`.
- **`slugify()`** — wspoldzielone z DD-004 (`src/lib/slug.ts`). Jedna kanoniczna implementacja.
- **Phone filter** — `b.phone IS NOT NULL` w query. Bez telefonu strona wizytowkowa bezuzyteczna.
- **Regeneracja** — brak automatycznej. Manual: `UPDATE businesses SET site_generated = 0 WHERE id = ?`.
