# DD-009a: SerpAPI Extended Fields

## Problem

Scraper discards ~7 valuable fields from SerpAPI Google Maps response. These fields are already paid for (included in every API call) but never saved. They're critical for Roadmap features (SEO Cluster, Proof of Demand).

## New fields

| SerpAPI field | D1 column | Type | Use case |
|---|---|---|---|
| `reviews` | `reviews_count` | INTEGER | Proof of Demand: "konkurent ma 47 opinii" |
| `type` | `google_type` | TEXT | Klaster SEO: precyzyjniejsza kategoria niż nasze 18 |
| `types` | `google_types` | TEXT (JSON) | Klaster SEO: multi-kategorie → podstrony usługowe |
| `description` | `description` | TEXT | Generator: lepszy input do AI content |
| `operating_hours` | `operating_hours` | TEXT (JSON) | Wizytówka: godziny otwarcia |
| `thumbnail` | `thumbnail_url` | TEXT | Wizytówka: zdjęcie firmy |
| `unclaimed_listing` | `unclaimed` | INTEGER (0/1) | Sprzedaż: gorący lead = niezarządzany profil |

### Pominięte celowo

| Pole | Powód |
|---|---|
| `position` | Zmienia się co scrape, per-query nie per-business. Lepiej w przyszłej tabeli `search_insights` (Roadmap #5) |
| `reviews_link` / `photos_link` | SerpAPI URLs, wymagają dodatkowych API calls. Przyszłość |
| `price` | Rzadko dostępne dla polskich firm |
| `service_options` | Głównie gastronomia (dine_in/takeout). Niska priorytet |
| `open_state` | Duplikat `operating_hours`, mniej precyzyjny |

---

## Zmiany

### 1. Migracja: `0003-business-extended-fields.sql`

```sql
ALTER TABLE businesses ADD COLUMN reviews_count INTEGER;
ALTER TABLE businesses ADD COLUMN google_type TEXT;
ALTER TABLE businesses ADD COLUMN google_types TEXT;     -- JSON array
ALTER TABLE businesses ADD COLUMN description TEXT;
ALTER TABLE businesses ADD COLUMN operating_hours TEXT;   -- JSON object
ALTER TABLE businesses ADD COLUMN thumbnail_url TEXT;
ALTER TABLE businesses ADD COLUMN unclaimed INTEGER DEFAULT 0;
```

7 nowych kolumn, wszystkie nullable (istniejące rekordy dostaną NULL).

### 2. Typ: `src/types/serpapi.ts`

```ts
interface SerpApiLocalResult {
  position: number;
  title: string;
  place_id: string;
  data_cid?: string;
  rating?: number;
  reviews?: number;                    // NEW
  address?: string;
  phone?: string;
  website?: string;
  type?: string;                       // already typed, now saved
  types?: string[];                    // NEW
  description?: string;               // NEW
  operating_hours?: Record<string, string>; // NEW
  thumbnail?: string;                  // NEW
  unclaimed_listing?: boolean;         // NEW
  gps_coordinates: SerpApiGpsCoordinates;
}
```

### 3. Typ: `src/types/business.ts`

```ts
interface BusinessInsert {
  // existing 12 fields...
  reviews_count: number | null;       // NEW
  google_type: string | null;         // NEW
  google_types: string | null;        // NEW (JSON stringified)
  description: string | null;         // NEW
  operating_hours: string | null;     // NEW (JSON stringified)
  thumbnail_url: string | null;       // NEW
  unclaimed: number;                  // NEW (0 or 1)
}
```

`BusinessRow` gets same 7 fields.

### 4. Scraper: `src/lib/scraper.ts`

Mapping w pętli `for (const r of catResults)`:

```ts
businesses.push({
  // ...existing fields...
  reviews_count: r.reviews ?? null,
  google_type: r.type ?? null,
  google_types: r.types ? JSON.stringify(r.types) : null,
  description: r.description ?? null,
  operating_hours: r.operating_hours ? JSON.stringify(r.operating_hours) : null,
  thumbnail_url: r.thumbnail ?? null,
  unclaimed: r.unclaimed_listing ? 1 : 0,
});
```

### 5. Batch insert: nowy rozmiar

Obecne: 12 kolumn × 8 wierszy = 96 params.
Nowe: **19 kolumn × 5 wierszy = 95 params** (< 100 limit D1).

`BATCH_SIZE` zmienia się z `8` na `5`.

INSERT statement:
```sql
INSERT OR IGNORE INTO businesses
  (title, slug, phone, address, website, category, rating,
   gps_lat, gps_lng, place_id, data_cid, locality_id,
   reviews_count, google_type, google_types, description,
   operating_hours, thumbnail_url, unclaimed)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

---

## Wpływ na istniejące dane

- NULL we wszystkich nowych kolumnach dla ~X istniejących rekordów
- Opcja backfill: re-scrape tych samych localities (INSERT OR IGNORE nie nadpisze). Alternatywnie: osobny UPDATE pass po place_id. Decyzja później.

## Wpływ na generator/wizytówkę

Generator (`src/lib/generator.ts`) może od razu korzystać z `description` i `operating_hours` żeby generować lepszy content. Nie jest to wymagane w tym DD — oddzielny etap.

---

## Weryfikacja

- [ ] `pnpm db:migrate` — migracja przechodzi bez błędów
- [ ] Scraper wstawia nowe pola — sprawdzić `SELECT reviews_count, google_type, unclaimed FROM businesses LIMIT 5`
- [ ] Istniejące rekordy mają NULL w nowych kolumnach
- [ ] Batch insert nie przekracza 100 params (19 × 5 = 95)
- [ ] TypeScript kompiluje bez błędów po zmianie typów
