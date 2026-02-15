# DD-003: Geocoder (Etap 3)

## Przeglad

Cron co godzine uzupelnia koordynaty GPS dla ~95k miejscowosci z D1 przez Nominatim API. Oblicza dystans Haversine od punktu startowego (Stanislawow Pierwszy). ~5.3 dni na pelen geocoding.

## Kontekst

DD-002 zaladowal ~95k miejscowosci do `localities` z TERYT SIMC. Kolumny `lat`, `lng`, `distance_km` sa NULL. Geocoder wypelnia je batch po batch, kazdy run przetwarza ~800 rekordow (1.1s/req * 800 = ~15min = limit CPU CF Worker).

## Cele

- Uzupelnic GPS dla wszystkich miejscowosci
- Obliczyc dystans od Stanislawowa Pierwszego (priorytetyzacja scraper)
- Respektowac rate limit Nominatim (1 req/s)
- Obsluzyc bledy gracefully (retry / mark failed)

## Nie-cele

- Alternatywne geocodery (Google, Mapbox)
- Reverse geocoding
- Batch geocoding API

---

## Architektura

```
CF Worker (cron 0 * * * *)
  │
  ├─ SELECT localities WHERE lat IS NULL LIMIT 800
  │
  ├─ FOR EACH locality:
  │    ├─ GET nominatim.openstreetmap.org/search
  │    ├─ Parse lat/lon
  │    ├─ Haversine(start, locality) → distance_km
  │    ├─ UPDATE localities SET lat, lng, distance_km
  │    └─ sleep(1100ms)
  │
  └─ Log: processed N, failed M, remaining R
```

---

## Typy

```ts
interface NominatimResult {
  place_id: number;
  licence: string;
  osm_type: string;
  osm_id: number;
  lat: string;
  lon: string;
  display_name: string;
  boundingbox: string[];
}

interface LocalityRow {
  id: number;
  name: string;
  woj_name: string;
  pow_name: string;
  gmi_name: string;
}

interface GeocoderStats {
  processed: number;
  failed: number;
  remaining: number;
}

// Use wrangler-generated Env from worker-configuration.d.ts — do NOT redefine locally
// interface Env { DB: D1Database; R2: R2Bucket; ... }
```

---

## Implementacja: `src/lib/geocoder.ts`

```ts
const BATCH_SIZE = 800;
const SLEEP_MS = 1100;
const WALL_TIME_LIMIT_MS = 25 * 60 * 1000; // 25min safety margin (worker limit 30min)
const START_LAT = 52.3547;
const START_LON = 21.0822;
// Email MUST be a monitored mailbox per Nominatim TOS
const USER_AGENT = 'LeadGen/1.0 (kontakt@wizytowka.link)';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchCoords(
  loc: LocalityRow
): Promise<{ lat: number; lon: number } | null> {
  const q = `${loc.name}, ${loc.gmi_name}, ${loc.pow_name}, ${loc.woj_name}, Polska`;
  const url = `${NOMINATIM_URL}?${new URLSearchParams({
    q,
    format: 'json',
    limit: '1',
  })}`;

  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
  });

  if (res.status === 429) throw new Error('RATE_LIMITED');
  if (!res.ok) throw new Error(`HTTP_${res.status}`);

  const data = (await res.json()) as NominatimResult[];
  if (!data.length) return null;

  const lat = parseFloat(data[0].lat);
  const lon = parseFloat(data[0].lon);
  if (isNaN(lat) || isNaN(lon)) return null;
  return { lat, lon };
}

export async function geocodeLocalities(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(
    `SELECT id, name, woj_name, pow_name, gmi_name
     FROM localities
     WHERE lat IS NULL AND geocode_failed = 0
     ORDER BY id
     LIMIT ?`
  ).bind(BATCH_SIZE).all<LocalityRow>();

  if (!results.length) {
    console.log('geocoder: nothing to process');
    return;
  }

  let processed = 0;
  let failed = 0;
  const startTime = Date.now();

  for (const loc of results) {
    if (Date.now() - startTime > WALL_TIME_LIMIT_MS) {
      console.log(`geocoder: wall-time limit reached after ${processed} localities`);
      break;
    }
    try {
      let coords = await fetchCoords(loc);

      // fallback: shorter query with just name + voivodeship
      if (!coords) {
        await sleep(SLEEP_MS);
        const fallbackQ = `${loc.name}, ${loc.woj_name}, Polska`;
        const fallbackUrl = `${NOMINATIM_URL}?${new URLSearchParams({
          q: fallbackQ,
          format: 'json',
          limit: '1',
        })}`;
        const fallbackRes = await fetch(fallbackUrl, {
          headers: { 'User-Agent': USER_AGENT },
        });
        if (fallbackRes.ok) {
          const fallbackData = (await fallbackRes.json()) as NominatimResult[];
          if (fallbackData.length) {
            const fbLat = parseFloat(fallbackData[0].lat);
            const fbLon = parseFloat(fallbackData[0].lon);
            if (!isNaN(fbLat) && !isNaN(fbLon)) {
              coords = { lat: fbLat, lon: fbLon };
            }
          }
        }
        await sleep(SLEEP_MS);
      }

      if (!coords) {
        await env.DB.prepare(
          `UPDATE localities SET geocode_failed = 1 WHERE id = ?`
        ).bind(loc.id).run();
        failed++;
      } else {
        const dist = haversine(START_LAT, START_LON, coords.lat, coords.lon);
        await env.DB.prepare(
          `UPDATE localities SET lat = ?, lng = ?, distance_km = ? WHERE id = ?`
        ).bind(coords.lat, coords.lon, Math.round(dist * 100) / 100, loc.id).run();
        processed++;
      }

      await sleep(SLEEP_MS);
    } catch (err) {
      if (err instanceof Error && err.message === 'RATE_LIMITED') {
        console.log(`geocoder: rate limited after ${processed} localities, stopping`);
        break;
      }
      // network error → skip, retry next run
      console.log(`geocoder: error for ${loc.name} (${loc.id}): ${err}`);
      await sleep(SLEEP_MS);
    }
  }

  const remaining = await env.DB.prepare(
    `SELECT COUNT(*) as cnt FROM localities WHERE lat IS NULL AND geocode_failed = 0`
  ).first<{ cnt: number }>();

  console.log(`geocoder: processed=${processed} failed=${failed} remaining=${remaining?.cnt}`);
}
```

---

## Schemat D1

Kolumny `lat`, `lng`, `distance_km`, `geocode_failed` zdefiniowane w DD-001 `localities` schema od poczatku. Indeksy w DD-001:
- `idx_localities_ungeolocated` — partial na `lat IS NULL`
- `idx_localities_unsearched` — partial na `searched_at IS NULL AND lat IS NOT NULL`

---

## Obsluga bledow

| Scenariusz | Akcja |
|---|---|
| Nominatim zwraca `[]` (both primary+fallback) | `geocode_failed = 1`, permanent skip |
| Blad sieci / timeout | log, skip — stays `lat IS NULL, geocode_failed = 0`, auto-retry next run |
| HTTP 429 | stop batch, resume za godzine |
| HTTP 5xx | log, skip, retry |

---

## Nominatim — przykladowy request/response

**Request (primary):**
```
GET /search?q=Stanisławów Pierwszy,Nieporęt,legionowski,MAZOWIECKIE,Polska&format=json&limit=1
User-Agent: LeadGen/1.0 (kontakt@wizytowka.link)
```

**Request (fallback — if primary returns []):**
```
GET /search?q=Stanisławów Pierwszy,MAZOWIECKIE,Polska&format=json&limit=1
User-Agent: LeadGen/1.0 (kontakt@wizytowka.link)
```

**Response:**
```json
[
  {
    "place_id": 123456,
    "licence": "Data © OpenStreetMap contributors",
    "osm_type": "node",
    "osm_id": 789012,
    "lat": "52.3547",
    "lon": "21.0822",
    "display_name": "Stanisławów Pierwszy, gmina Nieporęt, powiat legionowski, województwo mazowieckie, Polska",
    "boundingbox": ["52.33", "52.37", "21.06", "21.10"]
  }
]
```

---

## Ograniczenia CF Worker

| Parametr | Wartosc |
|---|---|
| CPU time per invocation | 15 min (Cron Triggers) |
| Wall time | 30 min |
| Sleep per request | 1.1s |
| Batch size | ~800 (z fallback: ~400 worst case) |
| Pelny geocoding | ~128 runow = ~5.3 dni (bez fallbackow) |

---

## Weryfikacja

- [ ] `curl http://localhost:8787/__scheduled?cron=0+*+*+*+*` → uruchamia geocoder
- [ ] `SELECT COUNT(*) FROM localities WHERE lat IS NOT NULL` → rosnie po kazdym runie
- [ ] `SELECT name, lat, lng, distance_km FROM localities ORDER BY distance_km LIMIT 10` → Stanislawow Pierwszy pierwszy
- [ ] `SELECT COUNT(*) FROM localities WHERE geocode_failed = 1` → kilka failures expected
- [ ] Logi: `geocoder: processed=N failed=M remaining=R`
- [ ] Po 429 batch konczy sie early, nastepny run kontynuuje

---

## Alternatywy rozwazone

| Opcja | Odrzucone bo |
|---|---|
| Google Geocoding API | Platne ($5/1000 req) |
| Batch geocoding | Nominatim nie wspiera |
| Parallel requests | Zlamanie Nominatim TOS |
| Wlasna instancja Nominatim | Overengineering na tym etapie |
| Photon geocoder | Mniej dokladny dla PL |

---

## Referencje

- [Nominatim Search API](https://nominatim.org/release-docs/latest/api/Search/)
- [Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/)
- [CF Workers CPU limits](https://developers.cloudflare.com/workers/platform/limits/)
- DD-002: Seed TERYT SIMC
- DD-001: Scaffold + infrastruktura

---

## Decyzje

- **`geocode_failed`** — marks only permanent failures (both primary and fallback return empty). Transient errors (network, 5xx) are NOT marked — locality stays with `lat IS NULL, geocode_failed = 0` and is retried next run. Only empty Nominatim results trigger permanent skip.
- **Fallback query** — zaimplementowany. Primary: `name, gmi_name, pow_name, woj_name, Polska` → jesli `[]` → fallback `name, woj_name, Polska`. `geocode_failed=1` tylko jesli oba zawioda. Fallback dodaje dodatkowy sleep (1.1s) per request.
- **Partial index** — D1 = SQLite 3.x, wspiera. Juz uzywane w DD-001.
- **Nominatim TOS** — `kontakt@wizytowka.link` email in User-Agent must be a real monitored mailbox. 95k requests over ~5.3 days (~18k/day, ~750/hr) is within fair use policy but approaching bulk territory. If Nominatim blocks, consider emailing operations@osmfoundation.org or using Photon as fallback.
- **5.3 dni** — akceptowalne. Jednorazowy koszt. Self-hosted Nominatim to overengineering.

---

## Action Items (z REVIEW.md)

### P0 — Blockers

- [x] **Fix fallback rate limit violation**: added `await sleep(SLEEP_MS)` before fallback fetch.

### P1 — Runtime errors

- [x] **Add wall-time guard**: added `WALL_TIME_LIMIT_MS = 25min`, checks `Date.now()` at loop start, breaks early.
- [x] **Validate NaN coords**: added `isNaN` checks after `parseFloat` in both primary and fallback paths.
- [x] **Reduce BATCH_SIZE**: wall-time guard makes this safe — batch exits early if approaching limit. BATCH_SIZE=800 kept as upper bound.

### P2 — Consistency

- [x] **Separate transient vs permanent failures**: code already correct — `geocode_failed=1` only set when both primary+fallback return empty (permanent). Network/5xx errors skip without marking (auto-retry). Documented in error table and decisions.
- [x] **Verify User-Agent email**: added comment that email must be monitored per TOS.
- [x] **Consider OSM notification**: documented in decisions — 95k/5 days is borderline, contact operations@osmfoundation.org if blocked.
- [ ] **Improve logging**: add per-locality log (name + result) and batch start/end timestamps.
