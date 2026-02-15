# DD-004a: SerpAPI Client + Types (Etap 4, Stage 1)

## Przeglad

SerpAPI Google Maps client z typami. Odpytuje kategorie z paginacja, zwraca parsed results. Slug generation dla business titles.

## Cele

- TypeScript types for SerpAPI responses + business inserts
- `scraper-api.ts`: `searchCategory` z paginacja (max 5 stron)
- `slug.ts`: `slugify` + `generateUniqueSlug` z batch dedup
- Parsowanie `local_results` + `serpapi_pagination`

## Nie-cele

- Orchestracja scrapera (004b)
- DB inserts (004b)
- Cron integration (004b)

---

## Typy TypeScript

### `src/types/serpapi.ts`

```ts
interface SerpApiGpsCoordinates {
  latitude: number;
  longitude: number;
}

interface SerpApiLocalResult {
  position: number;
  title: string;
  place_id: string;
  data_cid?: string;
  phone?: string;
  address?: string;
  website?: string;
  type?: string;
  rating?: number;
  gps_coordinates: SerpApiGpsCoordinates;
}

interface SerpApiPagination {
  next?: string;
}

interface SerpApiMapsResponse {
  local_results?: SerpApiLocalResult[];
  serpapi_pagination?: SerpApiPagination;
}
```

### `src/types/business.ts`

```ts
interface BusinessInsert {
  title: string;
  slug: string;
  phone: string | null;
  address: string | null;
  website: string | null;
  category: string;
  rating: number | null;
  gps_lat: number;
  gps_lng: number;
  place_id: string;
  data_cid: string | null;
  locality_id: number;
}

interface Locality {
  id: number;
  name: string;
  slug: string;
  lat: number;
  lng: number;
  distance_km: number;
  searched_at: string | null;
}
```

---

## Implementacja

### `src/lib/scraper-api.ts`

```ts
const SERPAPI_BASE = 'https://serpapi.com/search.json';
const MAX_PAGES_PER_CATEGORY = 5;

interface SearchCategoryResult {
  results: SerpApiLocalResult[];
  calls: number;
}

export async function searchCategory(
  env: Env,
  locality: Locality,
  category: string
): Promise<SearchCategoryResult> {
  const results: SerpApiLocalResult[] = [];
  let url: string | null = buildInitialUrl(env, locality, category);
  let page = 0;
  let calls = 0;

  while (url && page < MAX_PAGES_PER_CATEGORY) {
    const res = await fetch(url);
    calls++;
    if (res.status === 429) throw new Error('SerpAPI 429 quota exhausted');
    if (!res.ok) throw new Error(`SerpAPI ${res.status}`);

    const data: SerpApiMapsResponse = await res.json();

    if (data.local_results) {
      results.push(...data.local_results);
    }

    // `next` is a full absolute URL from SerpAPI (includes api_key + all params)
    url = data.serpapi_pagination?.next ?? null;
    page++;
  }

  return { results, calls };
}

function buildInitialUrl(env: Env, loc: Locality, category: string): string {
  const params = new URLSearchParams({
    engine: 'google_maps',
    q: `${category} ${loc.name}`,
    ll: `@${loc.lat},${loc.lng},14z`,
    api_key: env.SERP_API_KEY,
  });
  return `${SERPAPI_BASE}?${params}`;
}
```

### `src/lib/slug.ts`

Shared by DD-002 (localities seed), DD-004 (scraper), DD-005 (generator). Canonical implementation from DD-001.

```ts
const POLISH_MAP: Record<string, string> = {
  ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n',
  ó: 'o', ś: 's', ź: 'z', ż: 'z',
  Ą: 'a', Ć: 'c', Ę: 'e', Ł: 'l', Ń: 'n',
  Ó: 'o', Ś: 's', Ź: 'z', Ż: 'z',
};

export function slugify(text: string): string {
  return text
    .split('')
    .map((ch) => POLISH_MAP[ch] ?? ch)
    .join('')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const MAX_SLUG_ATTEMPTS = 50;

export async function generateUniqueSlug(
  title: string,
  localityId: number,
  db: D1Database
): Promise<string> {
  const base = slugify(title);

  const { results } = await db
    .prepare(
      `SELECT slug FROM businesses
       WHERE locality_id = ? AND (slug = ? OR slug LIKE ?)
       ORDER BY slug`
    )
    .bind(localityId, base, `${base}-%`)
    .all<{ slug: string }>();

  const existing = new Set(results.map((r) => r.slug));

  if (!existing.has(base)) return base;

  for (let suffix = 2; suffix <= MAX_SLUG_ATTEMPTS + 1; suffix++) {
    const candidate = `${base}-${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }

  throw new Error(`slug collision limit exceeded: ${base} in locality ${localityId}`);
}
```

**Batch slug dedup strategy** (used in 004b `scraper.ts`): Instead of calling `generateUniqueSlug` per business (N queries), scraper batch-fetches all existing slugs for the locality into an in-memory `Set<string>`, then deduplicates in-batch with suffix counter. Zero additional DB calls during slug assignment.

Przyklady:
| Tytul | Slug |
|---|---|
| Zaklad Fryzjerski Anna | `zaklad-fryzjerski-anna` |
| Restauracja "Pod Lipa" | `restauracja-pod-lipa` |
| ELEKTRYK 24h | `elektryk-24h` |

---

## Struktura plikow (ten etap)

```
src/
  lib/
    scraper-api.ts      -- SerpAPI client (searchCategory, buildInitialUrl)
    slug.ts             -- slugify + generateUniqueSlug (juz istnieje z DD-001)
  types/
    serpapi.ts           -- SerpApiLocalResult, SerpApiMapsResponse, etc.
    business.ts          -- BusinessInsert, Locality
```

---

## Weryfikacja

- [ ] `pnpm run types` — types compile, no errors
- [ ] `searchCategory` callable with test SerpAPI key — returns `SerpApiLocalResult[]`
- [ ] Pagination works: if >20 results, `serpapi_pagination.next` followed correctly
- [ ] `local_results` parsed into typed `SerpApiLocalResult[]` — all fields present
- [ ] `slugify('Zaklad Fryzjerski')` returns `zaklad-fryzjerski`
- [ ] `slugify('Restauracja "Pod Lipa"')` returns `restauracja-pod-lipa`
- [ ] `buildInitialUrl` produces valid SerpAPI URL with `engine=google_maps`
- [ ] 429 response throws `Error` with `'429'` in message

---

## Referencje

- [SerpAPI Google Maps API](https://serpapi.com/google-maps-api)
- [SerpAPI Google Maps Local Results](https://serpapi.com/maps-local-results)
- [SerpAPI pagination](https://serpapi.com/blog/scraping-all-business-listings-for-an-area-in-google-maps-using-node-js/)
- DD-001 (`src/lib/slug.ts` canonical impl, `src/types/` structure)
- DD-004 (original combined doc)

## Decyzje

- **`MAX_PAGES_PER_CATEGORY = 5`** — 18 cat x 5 pages = max 90 calls/locality. Fits $50/mo SerpAPI plan.
- **`next` URL** — SerpAPI returns full absolute URL including `api_key`. No manual page param building needed.
- **SerpAPI rate limit** — no documented per-second limit on paid plans. Sequential requests (pagination). No delay needed.
- **`data_cid`** — optional in response. Stored if available. Dedup only by `place_id`.
- **Batch slug strategy over per-business queries** — 1 query vs N queries. Critical for D1 performance.
