# DD-001b: Scaffold — D1 Schema + Types

## Przeglad

Czesc 2 z 2 scaffoldu (DD-001). Schema D1, migracja, typy biznesowe. Wymaga dzialajacego projektu z [001a-scaffold-project.md](./001a-scaffold-project.md) (wrangler.jsonc z `database_id`).

## Cele

- D1 schema: `localities`, `businesses`, `sellers`, `call_log`
- Migracja `migrations/0001-init.sql`
- Shared types w `src/types/` (business.ts, serpapi.ts, site.ts)

## Nie-cele

- Konfiguracja projektu/adaptera (DD-001a)
- Seed danych TERYT (DD-002)
- Implementacja geocodera/scrapera (DD-003, DD-004)

---

## D1 Schema

Plik: `migrations/0001-init.sql`

```sql
-- localities: ~95k miejscowosci z TERYT SIMC
CREATE TABLE IF NOT EXISTS localities (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  slug        TEXT    NOT NULL UNIQUE,
  sym         TEXT    NOT NULL UNIQUE,
  sym_pod     TEXT,
  woj         TEXT,
  woj_name    TEXT,
  pow         TEXT,
  pow_name    TEXT,
  gmi         TEXT,
  gmi_name    TEXT,
  lat            REAL,
  lng            REAL,
  distance_km    REAL,
  geocode_failed INTEGER NOT NULL DEFAULT 0,
  searched_at    TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_localities_slug ON localities(slug);
CREATE INDEX idx_localities_unsearched ON localities(searched_at, lat, distance_km)
  WHERE searched_at IS NULL AND lat IS NOT NULL;
CREATE INDEX idx_localities_ungeolocated ON localities(id)
  WHERE lat IS NULL AND geocode_failed = 0;

-- businesses: firmy znalezione przez scraper
CREATE TABLE IF NOT EXISTS businesses (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  locality_id    INTEGER NOT NULL REFERENCES localities(id),
  place_id       TEXT    NOT NULL UNIQUE,
  title          TEXT    NOT NULL,
  slug           TEXT    NOT NULL,
  phone          TEXT,
  address        TEXT,
  website        TEXT,
  category       TEXT    NOT NULL,
  rating         REAL,
  gps_lat        REAL    NOT NULL,
  gps_lng        REAL    NOT NULL,
  data_cid       TEXT,
  site_generated INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(slug, locality_id)
);

CREATE INDEX idx_businesses_locality ON businesses(locality_id);
CREATE INDEX idx_businesses_leads ON businesses(website, phone, site_generated)
  WHERE website IS NULL AND phone IS NOT NULL;
CREATE INDEX idx_businesses_place_id ON businesses(place_id);
CREATE INDEX idx_businesses_ungenerated ON businesses(id)
  WHERE website IS NULL AND phone IS NOT NULL AND site_generated = 0;

-- sellers: sprzedawcy z dostepem przez token
CREATE TABLE IF NOT EXISTS sellers (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT    NOT NULL,
  telegram_chat_id TEXT,
  token            TEXT    NOT NULL UNIQUE,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- idx_sellers_token not needed: UNIQUE constraint on token creates implicit index

-- call_log: historia kontaktow sprzedawca-firma
CREATE TABLE IF NOT EXISTS call_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  seller_id   INTEGER NOT NULL REFERENCES sellers(id),
  status      TEXT    NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'called', 'interested', 'rejected')),
  comment     TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_call_log_business ON call_log(business_id);
CREATE INDEX idx_call_log_seller_biz ON call_log(seller_id, business_id, created_at);
```

---

## Uwagi do schematu

- D1 = SQLite — brak typow `TIMESTAMP`, uzywa `TEXT` z `datetime('now')`
- `place_id NOT NULL UNIQUE` — deduplikacja firm z Google Maps
- `data_cid` — opcjonalny identyfikator CID z Google Maps
- `UNIQUE(slug, locality_id)` — unikalny slug w ramach miejscowosci (URL: `/{loc}/{slug}`)
- `gps_lat`, `gps_lng` NOT NULL — scraper zawsze dostarcza koordynaty
- Partial indexes (`WHERE`) — D1/SQLite 3.x wspiera, optymalizuja zapytania geocodera i scrapera
- `site_generated` jako `INTEGER` (0/1) — SQLite nie ma `BOOLEAN`
- FK wlaczone domyslnie w D1

---

## Diagram relacji

```
localities 1──* businesses 1──* call_log *──1 sellers
```

---

## Shared Types

### `src/types/business.ts`

```ts
interface LocalityRow {
  id: number;
  name: string;
  slug: string;
  sym: string;
  sym_pod: string | null;
  woj: string | null;
  woj_name: string | null;
  pow: string | null;
  pow_name: string | null;
  gmi: string | null;
  gmi_name: string | null;
  lat: number | null;
  lng: number | null;
  distance_km: number | null;
  geocode_failed: number;
  searched_at: string | null;
  created_at: string;
}

interface BusinessRow {
  id: number;
  locality_id: number;
  place_id: string;
  title: string;
  slug: string;
  phone: string | null;
  address: string | null;
  website: string | null;
  category: string;
  rating: number | null;
  gps_lat: number;
  gps_lng: number;
  data_cid: string | null;
  site_generated: number;
  created_at: string;
}

interface BusinessInsert {
  locality_id: number;
  place_id: string;
  title: string;
  slug: string;
  phone: string | null;
  address: string | null;
  website: string | null;
  category: string;
  rating: number | null;
  gps_lat: number;
  gps_lng: number;
  data_cid: string | null;
}

interface SellerRow {
  id: number;
  name: string;
  telegram_chat_id: string | null;
  token: string;
  created_at: string;
}

interface CallLogRow {
  id: number;
  business_id: number;
  seller_id: number;
  status: 'pending' | 'called' | 'interested' | 'rejected';
  comment: string | null;
  created_at: string;
}

export type { LocalityRow, BusinessRow, BusinessInsert, SellerRow, CallLogRow };
```

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
  rating?: number;
  address?: string;
  phone?: string;
  website?: string;
  type?: string;
  gps_coordinates: SerpApiGpsCoordinates;
}

interface SerpApiMapsResponse {
  local_results?: SerpApiLocalResult[];
  search_metadata: {
    status: string;
    id: string;
  };
}

export type { SerpApiGpsCoordinates, SerpApiLocalResult, SerpApiMapsResponse };
```

### `src/types/site.ts`

```ts
interface SiteHero {
  title: string;
  subtitle: string;
}

interface SiteData {
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

export type { SiteHero, SiteData };
```

---

## Struktura plikow (etap 001b)

```
wizytowka-link/
├── migrations/
│   └── 0001-init.sql
└── src/
    └── types/
        ├── business.ts
        ├── serpapi.ts
        └── site.ts
```

---

## Weryfikacja

1. **D1 database utworzony**
   ```bash
   pnpm wrangler d1 create leadgen
   # wpisz database_id do wrangler.jsonc
   ```

2. **Schema zaladowany**
   ```bash
   pnpm wrangler d1 execute leadgen --file=./migrations/0001-init.sql
   pnpm wrangler d1 execute leadgen --file=./migrations/0001-init.sql --remote
   ```

3. **Tabele istnieja**
   ```bash
   pnpm wrangler d1 execute leadgen --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
   pnpm wrangler d1 execute leadgen --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name" --remote
   # oczekiwany: businesses, call_log, localities, sellers
   ```

4. **Indexy istnieja**
   ```bash
   pnpm wrangler d1 execute leadgen --command="SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name"
   pnpm wrangler d1 execute leadgen --command="SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name" --remote
   # oczekiwany: idx_businesses_leads, idx_businesses_locality, idx_businesses_place_id,
   #   idx_businesses_ungenerated, idx_call_log_business, idx_call_log_seller_biz,
   #   idx_localities_slug, idx_localities_ungeolocated, idx_localities_unsearched
   ```

5. **FK wlaczone**
   ```bash
   pnpm wrangler d1 execute leadgen --command="PRAGMA foreign_keys"
   pnpm wrangler d1 execute leadgen --command="PRAGMA foreign_keys" --remote
   # oczekiwany: 1
   ```

6. **Pusta baza**
   ```bash
   pnpm wrangler d1 execute leadgen --command="SELECT COUNT(*) FROM localities"
   pnpm wrangler d1 execute leadgen --command="SELECT COUNT(*) FROM localities" --remote
   # oczekiwany: 0
   ```

7. **R2 bucket utworzony**
   ```bash
   pnpm wrangler r2 bucket create sites
   ```

8. **Typy kompiluja sie**
   ```bash
   npx tsc --noEmit src/types/business.ts src/types/serpapi.ts src/types/site.ts
   ```

---

## Decyzje

- **Partial indexes** — D1/SQLite 3.x wspiera `WHERE` w `CREATE INDEX`. Kluczowe dla wydajnosci geocodera (`idx_localities_ungeolocated`) i scrapera (`idx_localities_unsearched`).
- **`site_generated INTEGER`** — SQLite brak BOOLEAN. 0/1.
- **Brak `idx_sellers_token`** — `UNIQUE` constraint tworzy implicit index.
- **`UNIQUE(slug, locality_id)`** — composite unique zamiast globalnie unikalnego slug. URL: `/{locality_slug}/{business_slug}`.
- **Centralized types** — `src/types/` jako single source of truth. Inne DD importuja z tego katalogu.

## Action Items (resolved)

- [x] Fix `idx_localities_ungeolocated`: changed to `ON localities(id) WHERE lat IS NULL AND geocode_failed = 0`.
- [x] Remove redundant indexes: removed `idx_businesses_slug` (covered by UNIQUE) and `idx_call_log_seller` (covered by `idx_call_log_seller_biz`).
- [x] Add `idx_businesses_ungenerated` for DD-005 generator query.
- [x] `Env` type: all docs reference wrangler-generated types, no local `Env` definitions.
- [x] Centralized types: `src/types/` directory added with shared type definitions.

## Referencje

- [D1 Getting Started](https://developers.cloudflare.com/d1/get-started/)
- [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-usage/)
- [DD-001a: Project Init](./001a-scaffold-project.md)
- [PLAN.md](../../PLAN.md)
