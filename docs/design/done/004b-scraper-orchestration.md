# DD-004b: Scraper Orchestration + Dedup + Insert (Etap 4, Stage 2)

## Przeglad

Main scraper logic. Picks nearest unsearched locality, iterates 18 categories via SerpAPI client (DD-004a), deduplicates by `place_id`, batch-inserts to D1, marks locality as searched. Businesses without `website` with `phone` = leads.

## Cele

- `scraper.ts`: full orchestration (`scrapeBusinesses`, `getNextLocality`, `batchInsert`, `markSearched`)
- In-memory `place_id` dedup + DB-level `INSERT OR IGNORE`
- Slug collision handling within batch (usedSlugs Set)
- Partial scrape resilience (quota/timeout recovery)
- Cron integration via DD-001a `worker.ts`

## Nie-cele

- SerpAPI client implementation (DD-004a)
- Type definitions (DD-004a)
- Real-time scraping
- Phone verification

---

## Schemat bazy

From DD-001 `migrations/0001-init.sql`:

```sql
CREATE TABLE businesses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  website TEXT,          -- NULL = lead
  category TEXT NOT NULL,
  rating REAL,
  gps_lat REAL NOT NULL,
  gps_lng REAL NOT NULL,
  place_id TEXT NOT NULL UNIQUE,
  data_cid TEXT,
  locality_id INTEGER NOT NULL REFERENCES localities(id),
  site_generated INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(slug, locality_id)
);

CREATE INDEX idx_businesses_locality ON businesses(locality_id);
CREATE INDEX idx_businesses_leads ON businesses(website, phone, site_generated) WHERE website IS NULL AND phone IS NOT NULL;
CREATE INDEX idx_businesses_place_id ON businesses(place_id);
```

`searched_at TEXT` in `localities` — defined in DD-001 schema.

---

## Kategorie

```ts
const CATEGORIES = [
  'firma', 'sklep', 'restauracja', 'hydraulik', 'elektryk',
  'mechanik', 'fryzjer', 'dentysta', 'weterynarz', 'kwiaciarnia',
  'piekarnia', 'zakład pogrzebowy', 'fotograf', 'księgowość',
  'fizjoterapia', 'przedszkole', 'autokomis', 'usługi',
] as const;
```

18 categories. Max 5 pages each = max 90 API calls/locality.

---

## Implementacja

### `src/lib/scraper.ts`

```ts
const MAX_PAGES_PER_CATEGORY = 5;

export async function scrapeBusinesses(env: Env): Promise<void> {
  const locality = await getNextLocality(env.leadgen);
  if (!locality) return;

  const seen = new Set<string>();
  const businesses: BusinessInsert[] = [];
  let quotaExhausted = false;
  let apiCalls = 0;
  let failedCategories = 0;

  // batch-fetch existing slugs for this locality once
  const { results: existingSlugs } = await env.leadgen
    .prepare(`SELECT slug FROM businesses WHERE locality_id = ?`)
    .bind(locality.id)
    .all<{ slug: string }>();
  const usedSlugs = new Set(existingSlugs.map(r => r.slug));

  for (const category of CATEGORIES) {
    if (quotaExhausted) break;
    try {
      const { results: catResults, calls } = await searchCategory(env, locality, category);
      apiCalls += calls;
      for (const r of catResults) {
        if (seen.has(r.place_id)) continue;
        seen.add(r.place_id);

        let slug = slugify(r.title);
        // dedup slug against DB + in-batch
        let suffix = 2;
        const base = slug;
        while (usedSlugs.has(slug)) {
          slug = `${base}-${suffix++}`;
        }
        usedSlugs.add(slug);

        businesses.push({
          title: r.title,
          slug,
          phone: r.phone ?? null,
          address: r.address ?? null,
          website: r.website ?? null,
          category,
          rating: r.rating ?? null,
          gps_lat: r.gps_coordinates.latitude,
          gps_lng: r.gps_coordinates.longitude,
          place_id: r.place_id,
          data_cid: r.data_cid ?? null,
          locality_id: locality.id,
        });
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('429')) {
        console.error(`[scraper] quota exhausted at ${category}@${locality.name}`);
        quotaExhausted = true;
        break;
      }
      failedCategories++;
      console.error(`[scraper] ${category}@${locality.name}: ${err}`);
    }
  }

  await batchInsert(env.leadgen, businesses);
  console.log(`[scraper] ${locality.name}: ${businesses.length} biz, ${apiCalls} API calls, ${failedCategories} failed cats`);

  if (quotaExhausted) {
    console.log(`[scraper] skipping markSearched — quota exhausted`);
  } else if (failedCategories > 0) {
    console.log(`[scraper] markSearched despite ${failedCategories} failed categories — non-quota errors`);
    await markSearched(env.leadgen, locality.id);
  } else {
    await markSearched(env.leadgen, locality.id);
  }
}
```

### `getNextLocality`

```ts
async function getNextLocality(db: D1Database): Promise<Locality | null> {
  return db
    .prepare(
      `SELECT * FROM localities
       WHERE searched_at IS NULL AND lat IS NOT NULL AND geocode_failed = 0
       ORDER BY distance_km LIMIT 1`
    )
    .first<Locality>();
}
```

Picks nearest unsearched, geocoded, non-failed locality.

### `batchInsert`

```ts
// D1 max 100 bound params per statement; 12 cols = max 8 rows per batch
const COLS = 12;
const BATCH_SIZE = 8;

async function batchInsert(db: D1Database, businesses: BusinessInsert[]): Promise<void> {
  for (let i = 0; i < businesses.length; i += BATCH_SIZE) {
    const chunk = businesses.slice(i, i + BATCH_SIZE);
    const placeholders = chunk
      .map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .join(', ');
    const values = chunk.flatMap((b) => [
      b.title, b.slug, b.phone, b.address, b.website,
      b.category, b.rating, b.gps_lat, b.gps_lng,
      b.place_id, b.data_cid, b.locality_id,
    ]);

    await db
      .prepare(
        `INSERT OR IGNORE INTO businesses
         (title, slug, phone, address, website, category, rating,
          gps_lat, gps_lng, place_id, data_cid, locality_id)
         VALUES ${placeholders}`
      )
      .bind(...values)
      .run();
  }
}
```

### `markSearched`

```ts
async function markSearched(db: D1Database, localityId: number): Promise<void> {
  await db
    .prepare(`UPDATE localities SET searched_at = datetime('now') WHERE id = ?`)
    .bind(localityId)
    .run();
}
```

---

## Deduplikacja

Two levels:
1. **In-memory**: `Set<string>` by `place_id` — eliminates dupes across categories within one locality
2. **DB-level**: `UNIQUE(place_id)` + `INSERT OR IGNORE` — eliminates dupes across localities (businesses near borders)

### Slug collision handling within batch

Single DB query fetches all existing slugs for locality into `usedSlugs: Set<string>`. During category iteration, each new slug checked against Set. On collision, suffix incremented (`base-2`, `base-3`, ...). New slug added to Set immediately — prevents in-batch collisions without additional queries.

---

## Obsluga bledow

| Scenariusz | Akcja |
|---|---|
| SerpAPI 429 (quota) | Stop scraper, **nie** oznaczaj `searched_at` |
| SerpAPI timeout/5xx | Log, skip kategoria, kontynuuj |
| Fetch error (siec) | Log, skip kategoria |
| Brak wynikow | Normalne, kontynuuj |
| Duplikat `place_id` | `INSERT OR IGNORE` |
| Niepoprawne koordynaty | Skip rekord |
| Partial scrape (quota/worker timeout) | `searched_at` NOT set, next run retries same locality, `INSERT OR IGNORE` handles dupes |

### Czesciowe przeszukanie

If scraper breaks mid-run (quota, worker timeout):
- `searched_at` NOT set
- Next run retries same locality
- Dupes from previous partial run ignored (`INSERT OR IGNORE`)
- Lossless — no businesses lost

---

## Analiza kosztow

| Parametr | Wartosc |
|---|---|
| Kategorie | 18 |
| Max stron/kategoria | 5 |
| Max calls/miejscowosc | 90 |
| SerpAPI plan $50/mies | 5000 searches |
| Miejscowosci/mies (max) | ~55 |
| Miejscowosci/mies (real) | ~80-100 (most categories < 5 pages) |

### Optymalizacje kosztow

1. **Skip pustych kategorii**: 0 results on page 1 = no pagination
2. **Mniejsze wsie**: skip specialist categories for small localities — requires population data (not in SIMC)
3. **Wczesne przerwanie**: 5+ empty categories in a row = stop — small locality heuristic (deferred post-MVP)

---

## Filtr leadow

```sql
SELECT b.*, l.name AS locality_name, l.slug AS locality_slug
FROM businesses b
JOIN localities l ON l.id = b.locality_id
WHERE b.website IS NULL AND b.phone IS NOT NULL
ORDER BY b.created_at DESC;
```

---

## Integracja z cron

From DD-001a `src/worker.ts`:

```ts
case '0 8 * * *': {
  const { scrapeBusinesses } = await import('./lib/scraper');
  await scrapeBusinesses(env);
  break;
}
```

Daily 8:00 UTC. Scraper only — generator decoupled to own cron `*/5 * * * *` (see DD-005a).

---

## Weryfikacja

- [ ] `getNextLocality` picks nearest unsearched locality with coords + `geocode_failed = 0`
- [ ] `curl http://localhost:8787/__scheduled?cron=0+8+*+*+*` — scraper runs
- [ ] `SELECT COUNT(*) FROM businesses WHERE locality_id = 1` — > 0
- [ ] `SELECT COUNT(DISTINCT place_id) = COUNT(*) FROM businesses WHERE locality_id = 1` — no `place_id` dupes
- [ ] `SELECT * FROM businesses WHERE website IS NULL AND phone IS NOT NULL LIMIT 10` — leads exist with phones
- [ ] `SELECT searched_at FROM localities WHERE id = 1` — NOT NULL after successful run
- [ ] `SELECT slug, title FROM businesses WHERE locality_id = 1 LIMIT 5` — valid slugs, no collisions
- [ ] Partial scrape recovery: kill mid-run, re-run — `searched_at` still NULL, no dupes, resumes correctly
- [ ] 429 error: `searched_at` remains NULL
- [ ] Non-quota errors: categories skipped, `markSearched` still runs, logged

---

## Referencje

- DD-004a (SerpAPI client, types, slug generation)
- DD-001 (`businesses` schema in `migrations/0001-init.sql`)
- DD-001 (`src/worker.ts` cron dispatch)
- DD-003 (geocoding — provides `lat`/`lng` in `localities`)
- [D1 batch operations](https://developers.cloudflare.com/d1/build-with-d1/d1-client-api/)
- [CF Workers CPU limits](https://developers.cloudflare.com/workers/platform/limits/)

## Decyzje

- **Populacja miejscowosci** — brak w SIMC. Heurystyka "early break" (5 pustych kategorii) deferred post-MVP.
- **`search_progress`** — nie. Binary `searched_at` NULL/not-null + `INSERT OR IGNORE` on partial runs. Additional tracking = overengineering.
- **15min CPU limit** — SerpAPI calls = I/O (fetch), not CPU. 90 calls * ~1s = ~90s wall time. Large margin.
- **Slug cross-locality** — by design OK. `UNIQUE(slug, locality_id)` — same slug in different localities correct for URL `/{loc}/{slug}`.
- **Batch slug fetch** — 1 query for all slugs in locality vs N per-business queries. Decided in DD-004 review.
- **`markSearched` on non-quota errors** — runs despite failed categories. Only quota exhaustion blocks it. Rationale: non-quota errors (timeouts, 5xx) are transient per-category, retrying full locality wastes API calls.
