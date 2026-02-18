# Jak dziala wizytowka.link

## Ogolny opis

wizytowka.link to platforma lead-gen dla polskich firm lokalnych. System automatycznie:

1. Pobiera liste ~95k miejscowosci z rejestru TERYT
2. Geokoduje je (GPS) przez Nominatim
3. Scrapuje firmy z Google Maps (SerpAPI) -- zaczynajac od najblizszych miejscowosci
4. Generuje statyczne strony wizytowkowe (AI GLM-5) dla firm bez strony www
5. Serwuje te strony pod URL `wizytowka.link/{miejscowosc}/{firma}`
6. Udostepnia panel sprzedawcy z lista leadow (firmy bez www, z telefonem)
7. Wysyla dzienne raporty na Telegram

Cel biznesowy: sprzedawcy dzwonia do firm bez stron www, oferuja gotowa wizytowke, monetyzuja lead.

### Stos technologiczny

| Warstwa | Technologia |
|---|---|
| Runtime | Cloudflare Workers |
| Framework | Astro 5 SSR + `@astrojs/cloudflare` |
| Baza danych | Cloudflare D1 (SQLite) |
| Storage plikow | Cloudflare R2 |
| Cron | CF Cron Triggers |
| Jezyk | TypeScript strict |
| CSS | TailwindCSS 3 |
| AI (generacja tresci) | Z.AI GLM-5 |
| Geokodowanie | Nominatim (OpenStreetMap) |
| Scraping firm | SerpAPI (Google Maps) |
| Powiadomienia | Telegram Bot API |
| Deploy | wrangler deploy |

---

## Pipeline krok po kroku

### 1. Dane TERYT (miejscowosci)

**Co to jest:** TERYT SIMC to rejestr ~95 tys. miejscowosci w Polsce prowadzony przez GUS. Kazda miejscowosc ma unikalny symbol `sym`, nazwe, przynaleznosc administracyjna (wojewodztwo, powiat, gmina).

**Skad sie biora dane:**
- Pliki CSV pobrane recznie z [eTERYT](https://eteryt.stat.gov.pl): `simc.csv` (miejscowosci) + `terc.csv` (jednostki administracyjne)
- Eksport z eTERYT jest w kodowaniu Windows-1250 -- wymaga konwersji: `iconv -f WINDOWS-1250 -t UTF-8`

**Jak sa seedowane:**
- Skrypt `seed/parse-simc.ts` (uruchamiany reczny: `npx tsx seed/parse-simc.ts`):
  1. Parsuje SIMC CSV (~95k wierszy) i TERC CSV
  2. Buduje mapy lookup z TERC: kod wojewodztwa -> nazwa, kod powiatu -> nazwa, kod gminy -> nazwa
  3. Wzbogaca kazda miejscowosc o nazwy administracyjne z TERC
  4. Generuje unikalne slugi (normalizacja polskich znakow: `Stanislawow Pierwszy` -> `stanislawow-pierwszy`; kolizje rozwiazywane sufiksem `-{sym}`)
  5. Generuje SQL INSERT w batchach po 100 wierszy
  6. Wykonuje per wojewodztwo (16 etapow) przez `wrangler d1 execute`
- Stan zapisywany w `seed/.seed-state.json` -- mozna przerwac i wznowic
- Idempotentnosc: `INSERT OR IGNORE` + `UNIQUE` na `sym` i `slug`

**Wynik:** tabela `localities` z ~95k rekordami, kolumny `lat`/`lng`/`distance_km` poczatkowo NULL.

**Wymaga recznej interwencji:** tak -- jednorazowy seed. Pliki CSV pobierane recznie, skrypt uruchamiany recznie.

---

### 2. Geokodowanie (Nominatim)

**Co robi:** Uzupelnia wspolrzedne GPS (`lat`, `lng`) i dystans od punktu startowego (`distance_km`) dla kazdej miejscowosci.

**Cron:** `0 * * * *` (co godzine)

**Punkt startowy:** Stanislawow Pierwszy (52.3547, 21.0822) -- dystans od tego punktu uzyty do priorytetyzacji scrapera (najblizsze miejscowosci scrapowane pierwsze).

**Jak dziala (plik `src/lib/geocoder.ts`):**
1. Pobiera batch do 300 miejscowosci bez GPS (`lat IS NULL AND geocode_failed = 0`)
2. Dla kazdej miejscowosci:
   - Wysyla zapytanie do Nominatim: `{nazwa}, {gmina}, {powiat}, {wojewodztwo}, Polska`
   - Jesli brak wynikow -- fallback: `{nazwa}, {wojewodztwo}, Polska`
   - Jesli oba puste -- oznacza `geocode_failed = 1` (trwaly skip)
   - Jesli sukces -- zapisuje `lat`, `lng`, oblicza dystans Haversine, zapisuje metadane Nominatim
3. Respektuje rate limit: 1.1s sleep miedzy requestami
4. Wall-time guard: 12 minut (worker limit 30 min, margines bezpieczenstwa)
5. Przy HTTP 429 (rate limit) -- przerywa batch, kontynuuje w nastepnym runie

**Czas pelnego geokodowania:** ~5-6 dni (95k miejscowosci / ~300 na godzine)

**Ograniczenia:**
- Nominatim: max 1 req/s, User-Agent z emailem wymagany
- Worker wall-time: 30 min max, guard na 12 min
- Bledy sieci/5xx: skip bez oznaczania `geocode_failed`, auto-retry w nastepnym runie

**Zautomatyzowane:** tak (cron). Po jednorazowym seedzie localities dziala samodzielnie.

---

### 3. Scraping firm (SerpAPI)

**Co robi:** Wyszukuje firmy w Google Maps per miejscowosc, zapisuje do D1.

**Cron:** `0 8 * * *` (codziennie o 8:00 UTC)

**Jak dziala (plik `src/lib/scraper.ts` + `src/lib/scraper-api.ts`):**
1. Wybiera najblizsa nieodwiedzona miejscowosc (`searched_at IS NULL`, posortowane po `distance_km`)
2. Iteruje 18 kategorii:
   ```
   firma, sklep, restauracja, hydraulik, elektryk, mechanik, fryzjer,
   dentysta, weterynarz, kwiaciarnia, piekarnia, zaklad pogrzebowy,
   fotograf, ksiegowosc, fizjoterapia, przedszkole, autokomis, uslugi
   ```
3. Dla kazdej kategorii: zapytanie SerpAPI Google Maps z paginacja (max 5 stron per kategoria)
4. Deduplikacja:
   - In-memory: `Set<string>` po `place_id` -- eliminuje dupy miedzy kategoriami
   - DB-level: `UNIQUE(place_id)` + `INSERT OR IGNORE` -- eliminuje dupy miedzy miejscowosciami
5. Slug generation: normalizacja polska + dedup w ramach miejscowosci (sufiks `-2`, `-3`)
6. Batch insert: max 8 wierszy per INSERT (12 kolumn * 8 = 96 parametrow, limit D1 = 100)
7. Po zakonczeniu: `searched_at = datetime('now')` (nie ustawiany przy wyczerpaniu quoty SerpAPI)
8. Telegram: raport dzienny wysylany do wszystkich sellerow z `telegram_chat_id`

**Lead = firma bez strony www (`website IS NULL`) z numerem telefonu (`phone IS NOT NULL`)**

**Koszty SerpAPI:**
- 18 kategorii * max 5 stron = max 90 callek/miejscowosc
- Plan $50/mies = 5000 wyszukan = ~55-100 miejscowosci/mies (zalezy od wielkosci)

**Obsluga bledow:**
- SerpAPI 429 (quota): przerywa, NIE oznacza `searched_at` -- retry nastepnego dnia
- Bledy sieci/5xx: skip kategorii, kontynuuje
- Partial scrape: `INSERT OR IGNORE` zapewnia brak duplikow przy ponownym przetworzeniu

**Zautomatyzowane:** tak (cron). 1 miejscowosc/dzien.

---

### 4. Generowanie wizytowek (GLM-5 -> R2)

**Co robi:** Generuje JSON z trescia strony wizytowkowej per firma (bez www, z telefonem).

**Cron:** `*/5 * * * *` (co 5 minut, 1 firma per run = ~288 stron/dzien)

**Jak dziala (plik `src/lib/generator.ts`):**
1. Pobiera 1 firme: `website IS NULL AND phone IS NOT NULL AND site_generated = 0`
2. Buduje prompt:
   - System: "ekspert od marketingu lokalnych firm w Polsce"
   - User: dane firmy (nazwa, kategoria, adres, telefon, ocena Google)
   - Instrukcja formatu JSON + zasady (po polsku, 3-5 uslug, limity SEO)
3. Wysyla do Z.AI GLM-5 API (`https://api.z.ai/api/coding/paas/v4/chat/completions`)
4. Waliduje odpowiedz JSON: hero, about, services (min 1), contact, seo
5. Przypisuje motyw (palette + layout) deterministycznie z hash slugu + kategorii
6. Zapisuje JSON do R2: `sites/{locality_slug}/{business_slug}.json`
7. Ustawia `site_generated = 1` w D1

**Struktura generowanego JSON (`SiteData`):**
```json
{
  "hero": { "headline": "...", "subheadline": "..." },
  "about": { "title": "...", "text": "..." },
  "services": [{ "name": "...", "description": "..." }],
  "contact": { "cta_text": "...", "phone": "...", "address": "..." },
  "seo": { "title": "max 60 zn", "description": "max 155 zn" },
  "theme": "ocean"
}
```

**Motyw (theme system -- `src/lib/themes.ts`):**
- 8 palet kolorow: ocean, forest, sunset, royal, crimson, slate, teal, earth
- 3 layouty: centered, split, minimal
- Dobieranie: hash slugu -> palette z puli (z biasem per kategoria), hash slugu + '_layout' -> layout
- Deterministyczne: ten sam slug zawsze dostaje ten sam motyw

**Obsluga bledow:** skip + retry w nastepnym runie (`site_generated` zostaje 0). Bledy nie blokuja kolejnych firm.

**Sekrety:** `ZAI_API_KEY` w `.production.vars`

**Zautomatyzowane:** tak (cron).

---

### 5. Strony SSR (Astro)

**Co robi:** Renderuje strone wizytowkowa z JSON w R2.

**URL:** `wizytowka.link/{locality_slug}/{business_slug}`

**Jak dziala (plik `src/pages/[loc]/[slug].astro`):**
1. Pobiera JSON z R2: `sites/{loc}/{slug}.json`
2. Jesli brak -- 404
3. Pobiera dane firmy z D1 (dla JSON-LD schema LocalBusiness)
4. Renderuje przez `BusinessSite.astro` -> layout component (CenteredLayout / SplitLayout / MinimalLayout)
5. Cache: `max-age=86400` (1 dzien browser), `s-maxage=604800` (7 dni edge)

**Sekcje strony:** Hero (z CTA `tel:`), O firmie, Uslugi (3-5), Kontakt (`tel:`), Footer

**SEO:**
- `<title>` i `<meta description>` z generowanego JSON
- OG meta tags
- JSON-LD LocalBusiness schema (nazwa, telefon, adres, kategoria, GPS, ocena)

**Inne strony:**
- `/` -- landing page
- `/polityka-prywatnosci` -- polityka prywatnosci
- `/regulamin` -- regulamin

**Zautomatyzowane:** tak (SSR on-demand).

---

### 6. Panel sprzedawcy

**Co robi:** Wewnetrzny panel do przegladania i obdzwaniania leadow.

**URL:** `wizytowka.link/s/{token}` (token w URL = autoryzacja, noindex/nofollow)

**Jak dziala (plik `src/pages/s/[token].astro`):**
1. Walidacja tokenu: `SELECT * FROM sellers WHERE token = ?`
2. Pobiera leady: firmy bez www z telefonem, LEFT JOIN z `call_log` (status ostatniego kontaktu per sprzedawca)
3. Filtry: status (pending/called/interested/rejected), miejscowosc, sortowanie (data/status)
4. Paginacja: 50 leadow/strona

**Statusy leada:**
```
pending -> called -> interested
                 \-> rejected
```

**Interakcje (client JS w `SellerPanel.astro`):**
- Zmiana statusu -> `PUT /api/leads/{id}?token=...` z `{ status, comment }` -> nowy wpis w `call_log` (append-only)
- Zmiana komentarza -> `PUT /api/leads/{id}?token=...` z `{ comment }` -> UPDATE istniejacego wpisu (bez nowego logu)
- Optymistyczny update badge statusu

**API endpoint (plik `src/pages/api/leads/[id].ts`):**
- `PUT /api/leads/{id}` -- token w `X-Seller-Token` header lub `?token=` query param
- Walidacja: token, body JSON, status, istnienie firmy
- Zmiana statusu: `INSERT INTO call_log` (append-only, pelna historia)
- Tylko komentarz: `UPDATE call_log SET comment` (in-place, ostatni wpis)

**Tworzenie sprzedawcy:** reczny INSERT do D1:
```bash
wrangler d1 execute leadgen --command="INSERT INTO sellers (name, token) VALUES ('Jan', 'uuid-token')" --remote
```

---

### 7. Powiadomienia Telegram

**Dwa komponenty:**

#### a) Raport dzienny (po scrape'ie)

Po zakonczeniu scrapera (`src/lib/scraper.ts` -> `src/lib/telegram.ts`):
- Pobiera statystyki: ile firm znaleziono, ile leadow (bez www z tel), top 5 leadow
- Wysyla do wszystkich sellerow z `telegram_chat_id`
- Format: HTML, link do panelu

Przyklad:
```
Raport dzienny -- 2026-02-18

Przeszukano: Stanislawow Pierwszy
Znaleziono firm: 47
Nowych leadow (bez www): 12

Top leady:
1. Zaklad Stolarski Kowalski -- stolarz -- +48 600 123 456
2. Piekarnia u Zosi -- piekarnia -- +48 601 234 567
...i 7 wiecej

Otworz panel ->
```

#### b) Webhook rejestracji (`/start`)

Endpoint: `POST /api/telegram/webhook/{TG_WEBHOOK_SECRET}`

Flow rejestracji sprzedawcy:
1. Admin tworzy sellera w D1 z tokenem
2. Admin generuje link: `https://t.me/wizytowka_link_bot?start={token}`
3. Sprzedawca klika link -> bot wysyla `/start {token}`
4. Webhook parsuje token -> `UPDATE sellers SET telegram_chat_id = ?`
5. Od teraz seller dostaje dzienne raporty

**Obsluga:** webhook zawsze zwraca 200 (Telegram retryuje przy innym kodzie). Rate limit: log + skip.

**Sekrety:** `TG_BOT_TOKEN`, `TG_WEBHOOK_SECRET` w `.production.vars`

#### c) Formularz kontaktowy

Endpoint: `POST /api/contact` -- przyjmuje numer telefonu z formularza na stronie glownej, weryfikuje przez Cloudflare Turnstile, wysyla powiadomienie Telegram do sellerow.

---

### 8. Deploy na Cloudflare

**Infrastruktura:**
```
                Internet
                   |
           wizytowka.link (CF DNS + SSL)
                   |
            Cloudflare Worker
            |-- fetch() --> Astro SSR
            |   /s/{token}      (panel)
            |   /{loc}/{slug}   (wizytowka)
            |   /api/telegram   (webhook)
            |   /api/leads      (API)
            |   /api/contact    (formularz)
            |
            |-- scheduled()
            |   0 * * * *       --> geocoder -> Nominatim
            |   0 8 * * *       --> scraper -> SerpAPI -> Telegram
            |   */5 * * * *     --> generator -> Z.AI -> R2
            |
            D1 (leadgen)  R2 (sites)  Secrets (4 klucze)
```

**Deploy:**
```bash
pnpm run build && pnpm wrangler deploy
```

**Sekrety (`.production.vars`, nigdy w repo):**

| Zmienna | Cel |
|---|---|
| `SERP_API_KEY` | SerpAPI -- wyszukiwanie firm w Google Maps |
| `ZAI_API_KEY` | Z.AI GLM-5 -- generowanie tresci stron |
| `TG_BOT_TOKEN` | Telegram Bot API -- raporty i rejestracja |
| `TG_WEBHOOK_SECRET` | Secret w URL webhooka Telegram |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile -- weryfikacja formularza |

**Rollback:** `pnpm wrangler rollback` (natychmiastowe). D1: Time Travel (30 dni). R2: obiekty persistuja miedzy deployami.

---

## Co jest zautomatyzowane vs reczne

| Etap | Zautomatyzowane | Reczne |
|---|---|---|
| Seed TERYT localities | -- | Tak (jednorazowy skrypt) |
| Geokodowanie | Cron co godzine | -- |
| Scraping firm | Cron codziennie 8:00 UTC | -- |
| Generowanie wizytowek | Cron co 5 min | -- |
| Serwowanie stron SSR | On-demand | -- |
| Raporty Telegram | Po scrape'ie | -- |
| Dodanie sprzedawcy | -- | INSERT do D1 + link TG |
| Obdzwanianie leadow | -- | Sprzedawca przez panel |
| Deploy | -- | `pnpm wrangler deploy` |
| Monitoring | Podstawowy (CF Dashboard) | Manualna kontrola MVP |

---

## Kto co robi

### Dev (administrator systemu)

- Konfiguracja: `wrangler.jsonc`, sekrety, domena
- Jednorazowy seed TERYT (`npx tsx seed/parse-simc.ts`)
- Deploy (`pnpm wrangler deploy`)
- Dodawanie sellerow (INSERT do D1 + generowanie link TG)
- Monitoring logow (`pnpm wrangler tail`)
- Migracje D1 (`wrangler d1 execute`)

### System (automatyczne crony)

- Geokodowanie co godzine
- Scraping 1 miejscowosci/dzien
- Generowanie ~288 wizytowek/dzien
- Dzienne raporty Telegram do sellerow

### Sprzedawca

- Rejestracja przez link Telegram (`/start {token}`)
- Codziennie: sprawdzenie raportu TG lub panelu `wizytowka.link/s/{token}`
- Obdzwanianie leadow: klikniecie numeru telefonu
- Zmiana statusu leada: pending -> called -> interested/rejected
- Dodawanie komentarzy

---

## Schemat bazy danych (D1)

### Tabele

```
localities 1──* businesses 1──* call_log *──1 sellers
```

#### `localities` (~95k rekordow)

Miejscowosci z rejestru TERYT.

| Kolumna | Typ | Opis |
|---|---|---|
| `id` | INTEGER PK | auto |
| `name` | TEXT NOT NULL | nazwa miejscowosci |
| `slug` | TEXT UNIQUE | slug URL |
| `sym` | TEXT UNIQUE | symbol SIMC |
| `sym_pod` | TEXT | symbol podrzednej |
| `woj`, `pow`, `gmi` | TEXT | kody administracyjne |
| `woj_name`, `pow_name`, `gmi_name` | TEXT | nazwy administracyjne (z TERC) |
| `lat`, `lng` | REAL | GPS (z Nominatim) |
| `distance_km` | REAL | dystans od Stanislawowa Pierwszego |
| `geocode_failed` | INTEGER (0/1) | Nominatim nie znalazl |
| `searched_at` | TEXT | kiedy scraper przetworzyl |
| `nominatim_place_id`, `osm_type`, `osm_id`, `nominatim_type`, `place_rank`, `address_type`, `bbox` | rozne | metadane Nominatim (migracja 0002) |
| `created_at` | TEXT | datetime('now') |

Kluczowe indeksy:
- `idx_localities_ungeolocated`: `WHERE lat IS NULL AND geocode_failed = 0` -- dla geocodera
- `idx_localities_unsearched`: `WHERE searched_at IS NULL AND lat IS NOT NULL` -- dla scrapera

#### `businesses`

Firmy znalezione przez scraper.

| Kolumna | Typ | Opis |
|---|---|---|
| `id` | INTEGER PK | auto |
| `locality_id` | INTEGER FK | -> localities.id |
| `place_id` | TEXT UNIQUE | Google Maps place_id (dedup) |
| `title` | TEXT NOT NULL | nazwa firmy |
| `slug` | TEXT NOT NULL | slug URL, UNIQUE(slug, locality_id) |
| `phone` | TEXT | numer telefonu |
| `address` | TEXT | adres |
| `website` | TEXT | strona www (NULL = lead!) |
| `category` | TEXT NOT NULL | kategoria z SerpAPI |
| `rating` | REAL | ocena Google |
| `gps_lat`, `gps_lng` | REAL NOT NULL | GPS z Google Maps |
| `data_cid` | TEXT | Google Maps CID |
| `site_generated` | INTEGER (0/1) | czy wizytowka wygenerowana |
| `created_at` | TEXT | datetime('now') |

Kluczowe indeksy:
- `idx_businesses_leads`: `WHERE website IS NULL AND phone IS NOT NULL` -- filtr leadow
- `idx_businesses_ungenerated`: `WHERE website IS NULL AND phone IS NOT NULL AND site_generated = 0` -- dla generatora

#### `sellers`

Sprzedawcy z dostepem tokenem.

| Kolumna | Typ | Opis |
|---|---|---|
| `id` | INTEGER PK | auto |
| `name` | TEXT NOT NULL | imie/nazwa |
| `telegram_chat_id` | TEXT | chat ID z Telegram (po `/start`) |
| `token` | TEXT UNIQUE | token autoryzacyjny w URL |
| `created_at` | TEXT | datetime('now') |

#### `call_log`

Historia kontaktow sprzedawca-firma. Append-only przy zmianie statusu.

| Kolumna | Typ | Opis |
|---|---|---|
| `id` | INTEGER PK | auto |
| `business_id` | INTEGER FK | -> businesses.id |
| `seller_id` | INTEGER FK | -> sellers.id |
| `status` | TEXT | CHECK: pending, called, interested, rejected |
| `comment` | TEXT | komentarz sprzedawcy |
| `created_at` | TEXT | datetime('now') |

### Migracje

- `migrations/0001-init.sql` -- schemat bazowy (localities, businesses, sellers, call_log + indeksy)
- `migrations/0002-geocoder-columns.sql` -- dodatkowe kolumny Nominatim w localities

---

## Kluczowe ograniczenia techniczne

| Ograniczenie | Wartosc | Konsekwencja |
|---|---|---|
| **D1 max parametrow per statement** | 100 | Batch insert: max 8 wierszy * 12 kolumn = 96 parametrow |
| **Nominatim rate limit** | 1 req/s | Sleep 1.1s miedzy requestami, ~300 miejscowosci/godzine |
| **Worker wall-time** | 30 min | Guard na 12 min w geocoderze |
| **Worker CPU time (cron)** | 15 min | Scraper: ~90 callek SerpAPI = ~90s wall time, duzy margines |
| **SerpAPI quota** | 5000 req/mies ($50 plan) | ~55-100 miejscowosci/mies |
| **Telegram wiadomosc** | max 4096 znakow | Truncation z "..." |
| **Telegram rate limit** | 30 msg/s global | Bez problemu przy kilku sellerach |
| **R2 key pattern** | `sites/{loc}/{biz}.json` | Zgodny miedzy generatorem a SSR route |
| **Edge cache** | 7 dni (`s-maxage=604800`) | Purge recznie przez CF API |
| **SQLite brak BOOLEAN** | INTEGER 0/1 | `site_generated`, `geocode_failed` |
| **SQLite brak TIMESTAMP** | TEXT | `datetime('now')` |
| **Slug unikalnoscg** | `UNIQUE(slug, locality_id)` | Ten sam slug w roznych miejscowosciach OK |

---

## Struktura plikow

```
src/
  worker.ts              # CF Worker entry: fetch() + scheduled()
  pages/
    index.astro          # landing page
    [loc]/[slug].astro   # strona wizytowkowa SSR
    s/[token].astro      # panel sprzedawcy
    api/
      leads/[id].ts      # PUT status/comment leada
      contact.ts         # POST formularz kontaktowy
      telegram/webhook/[secret].ts  # Telegram webhook
    polityka-prywatnosci.astro
    regulamin.astro
  lib/
    geocoder.ts          # cron: Nominatim geokodowanie
    scraper.ts           # cron: orkiestracja scrapera + Telegram raport
    scraper-api.ts       # SerpAPI client + paginacja
    generator.ts         # cron: GLM-5 generacja JSON -> R2
    telegram.ts          # sendMessage + formatDailyReport
    slug.ts              # slugify z polska normalizacja
    themes.ts            # 8 palet + 3 layouty, deterministyczne z hash
  types/
    business.ts          # LocalityRow, BusinessRow, BusinessInsert, SellerRow, CallLogRow
    site.ts              # SiteData (hero, about, services, contact, seo)
    serpapi.ts           # SerpApiLocalResult, SerpApiMapsResponse
  components/
    BusinessSite.astro   # glowny komponent wizytowki (head + JSON-LD + layout dispatch)
    SellerPanel.astro    # panel sprzedawcy (filtry + karty leadow + client JS)
    layouts/
      CenteredLayout.astro
      SplitLayout.astro
      MinimalLayout.astro
migrations/
  0001-init.sql          # schemat bazowy
  0002-geocoder-columns.sql  # kolumny Nominatim
scripts/                 # parsery TERYT CSV + seed runner
data/                    # pliki CSV SIMC/TERC
docs/
  design/                # design docs (001-008)
  notes/                 # notatki
wrangler.jsonc           # konfiguracja CF Worker
```

---

## Komendy

```bash
pnpm dev              # Astro dev server (lokalnie)
pnpm build            # build SSR do dist/
pnpm preview          # wrangler dev (lokalna emulacja CF)
pnpm deploy           # wrangler deploy (produkcja)
pnpm db:migrate       # migracje D1

# Cron trigger (lokalne testowanie):
curl "http://localhost:8787/cdn-cgi/handler/scheduled"

# Logi produkcji:
pnpm wrangler tail
```
