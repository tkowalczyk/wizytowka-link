# PLAN.md — wizytowka.link

## O systemie

System automatycznie wyszukuje lokalne firmy w Polsce, ktore nie posiadaja strony internetowej. Codziennie o 8:00 przeszukuje kolejna miejscowosc (startujac od Stanislawowa Pierwszego i rozszerzajac sie koncentrycznie na cala Polske), zapisuje znalezione firmy i generuje dla nich prostą strone wizytowkowa. Sprzedawca otrzymuje powiadomienie na Telegramie z linkiem do panelu, gdzie widzi liste firm do obdzwonienia wraz z telefonami. W panelu oznacza status kontaktu i zostawia komentarze.

---

## Etap 1: Scaffold projektu + infrastruktura

Astro + Cloudflare Worker z trzema cron triggerami, D1, R2.

### Zadania
- `npm create astro@latest` z adapterem `@astrojs/cloudflare`
- Skonfigurowac `workerEntryPoint` w `astro.config.mjs` — custom entry point eksportujacy `fetch` (Astro SSR) + `scheduled` handler
- `wrangler.jsonc` z bindingami D1 (`leadgen`), R2 (`sites`), zmiennymi srodowiskowymi (klucze API jako secrets)
- D1 schema: `localities`, `businesses`, `sellers`, `call_log`
- Wygenerowac typy CF: `wrangler types`

### Custom entry point (`src/worker.ts`)
```ts
import type { SSRManifest } from 'astro';
import { App } from 'astro/app';
import { handle } from '@astrojs/cloudflare/handler';

export function createExports(manifest: SSRManifest) {
  const app = new App(manifest);
  return {
    default: {
      async fetch(request, env: Env, ctx: ExecutionContext) {
        return handle(manifest, app, request, env, ctx);
      },
      async scheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
        switch (controller.cron) {
          case '0 * * * *':   // geocoder
            const { geocodeLocalities } = await import('./lib/geocoder');
            await geocodeLocalities(env);
            break;
          case '0 8 * * *':   // scraper
            const { scrapeBusinesses } = await import('./lib/scraper');
            await scrapeBusinesses(env);
            break;
          case '*/5 * * * *': // site generator
            const { generateSites } = await import('./lib/generator');
            await generateSites(env);
            break;
        }
      },
    } satisfies ExportedHandler<Env>,
  };
}
```

### Weryfikacja
- `curl "http://localhost:8787/cdn-cgi/handler/scheduled"` → uruchom scheduled handler
- `wrangler d1 execute leadgen --command="SELECT COUNT(*) FROM localities"` zwraca 0 (pusta tabela)

### Dokumentacja
- [@astrojs/cloudflare adapter](https://docs.astro.build/en/guides/integrations-guide/cloudflare/)
- [Astro on CF Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/astro/)
- [Scheduled handler API](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/)
- [Multiple Cron Triggers](https://developers.cloudflare.com/workers/examples/multiple-cron-triggers/)
- [D1 Getting Started](https://developers.cloudflare.com/d1/get-started/)
- [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-usage/)
- [wrangler.jsonc config](https://developers.cloudflare.com/workers/wrangler/configuration/)

---

## Etap 2: Seed TERYT SIMC

Zaladowanie ~102k polskich miejscowosci do D1.

### Zadania
- Plik SIMC CSV dostepny w `data/simc.csv`
- Skrypt Node `scripts/parse-simc.ts`: CSV → SQL INSERT
  - Kolumny SIMC: `WOJ`, `POW`, `GMI`, `RODZ_GMI`, `NAZWA`, `SYM`, `SYMPOD`
  - Wzbogacic o nazwy wojewodztw/powiatow/gmin z TERC
  - Wygenerowac slug lokalizacji z nazwy (`Stanisławów Pierwszy` → `stanislawow-pierwszy`)
- Seed runner: `scripts/seed-localities.ts`

### Weryfikacja
- `SELECT COUNT(*) FROM localities` → ~102 000
- `SELECT * FROM localities WHERE name = 'Stanisławów Pierwszy'` → 1 rekord z gmina=Nieporet, powiat=legionowski

### Dokumentacja
- [TERYT SIMC download](https://eteryt.stat.gov.pl/eTeryt/rejestr_teryt/udostepnianie_danych/baza_teryt/uzytkownicy_indywidualni/pobieranie/pobieranie.aspx)
- [TERYT API](https://api.stat.gov.pl/Home/TerytApi)
- [D1 import data](https://developers.cloudflare.com/d1/best-practices/import-export-data/)

---

## Etap 3: Geocoder (Cron co godzine)

Uzupelnianie koordynatow GPS dla miejscowosci z Nominatim.

### Zadania
- `src/lib/geocoder.ts`: pobiera batch miejscowosci z D1 (`WHERE lat IS NULL`), odpytuje Nominatim, zapisuje lat/lng
- Haversine distance od punktu startowego (52.3547, 21.0822) → kolumna `distance_km`
- Rate limit: `await sleep(1100)` miedzy requestami (Nominatim wymaga 1 req/s)
- Wall-time guard: 25min timeout
- Header `User-Agent: LeadGen/1.0 (kontakt@wizytowka.link)` — wymagany przez Nominatim

### Weryfikacja
- `curl "http://localhost:8787/cdn-cgi/handler/scheduled"` → uruchom geocoder
- `SELECT COUNT(*) FROM localities WHERE lat IS NOT NULL` → rosnie po kazdym runie
- `SELECT name, lat, lng, distance_km FROM localities ORDER BY distance_km LIMIT 10` → Stanislawow Pierwszy pierwszy, sensowne koordynaty

### Dokumentacja
- [Nominatim Search API](https://nominatim.org/release-docs/latest/api/Search/)
- [Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/)
- [CF Workers CPU limits](https://developers.cloudflare.com/workers/platform/limits/)

---

## Etap 4: Scraper (Cron codziennie 8:00)

Wyszukiwanie firm w kolejnej miejscowosci przez SerpAPI Google Maps.

### Zadania
- `src/lib/scraper.ts` (orchestrator) + `src/lib/scraper-api.ts` (SerpAPI client):
  1. Pobierz nastepna nieprzeszukana miejscowosc (`WHERE searched_at IS NULL AND lat IS NOT NULL ORDER BY distance_km LIMIT 1`)
  2. Dla kazdej z 18 kategorii (`firma`, `sklep`, `restauracja`, `hydraulik`, `elektryk`, `mechanik`, `fryzjer`, `dentysta`, `weterynarz`, `kwiaciarnia`, `piekarnia`, `zakład pogrzebowy`, `fotograf`, `księgowość`, `fizjoterapia`, `przedszkole`, `autokomis`, `usługi`):
     - `GET https://serpapi.com/search.json?engine=google_maps&q={query}&ll=@{lat},{lng},14z&api_key={key}`
     - Paginacja: follow `serpapi_pagination.next` do wyczerpania (max 5 stron)
  3. Deduplikacja po `place_id` lub `data_cid`
  4. INSERT do `businesses` — batch max 8 rows (D1 100-param limit)
  5. UPDATE `localities SET searched_at = datetime('now')`
- Filtr leadow: `website IS NULL AND phone IS NOT NULL`

### Weryfikacja
- Ustawic test locality (np. Stanislawow Pierwszy z koordynatami) → uruchomic scraper
- `SELECT COUNT(*) FROM businesses WHERE locality_id = 1` → > 0
- `SELECT * FROM businesses WHERE website IS NULL AND phone IS NOT NULL` → lista leadow

### Dokumentacja
- [SerpAPI Google Maps API](https://serpapi.com/google-maps-api)
- [SerpAPI Google Maps Local Results](https://serpapi.com/maps-local-results)
- [SerpAPI pagination](https://serpapi.com/blog/scraping-all-business-listings-for-an-area-in-google-maps-using-node-js/)

---

## Etap 5: Generator stron (Workers AI GLM-5)

Generowanie tresci strony wizytowkowej dla firm bez www.

### Zadania
- `src/lib/generator.ts` + osobny cron `*/5 * * * *`:
  1. Pobierz firmy z `businesses WHERE website IS NULL AND site_generated = 0`
  2. Wywolaj Workers AI (GLM-5) — bound via `env.AI`
  3. Prompt: na bazie nazwy, kategorii, adresu, telefonu, ratingu → wygeneruj JSON z sekcjami strony (hero, about, services, contact, CTA)
  4. Zapisz JSON do R2: `sites/{loc_slug}/{biz_slug}.json`
  5. UPDATE `businesses SET site_generated = 1`
- `src/lib/themes.ts`: 8 palet kolorow + category→palette mapping + hash-based layout
- Astro SSR route `src/pages/[loc]/[slug].astro`:
  1. Odczytaj JSON z R2 przez `Astro.locals.runtime.env.sites`
  2. Renderuj responsywna strone z Tailwind + tematem

### Weryfikacja
- Uruchom generator dla testowej firmy
- `wrangler r2 object get sites/stanislawow-pierwszy/firma-testowa.json` → poprawny JSON (SiteData)
- `curl http://localhost:4321/stanislawow-pierwszy/firma-testowa` → wyrenderowana strona HTML

### Dokumentacja
- [Workers AI](https://developers.cloudflare.com/workers-ai/)
- [R2 Workers API put/get](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
- [Astro dynamic routes](https://docs.astro.build/en/guides/routing/#dynamic-routes)
- [Astro CF bindings access](https://docs.astro.build/en/guides/integrations-guide/cloudflare/#cloudflare-runtime)

---

## Etap 6: Panel sprzedawcy

Deep-linked panel (bez logowania) z lista leadow do obdzwonienia.

### Zadania
- `src/pages/s/[token].astro` — glowna strona panelu:
  1. Walidacja tokenu z `sellers` table
  2. Lista leadow: nazwa firmy, telefon, adres, kategoria, link do wygenerowanej strony, status, komentarz
  3. Filtry: status (pending/called/interested/rejected), miejscowosc
  4. Sortowanie: po dacie znalezienia, statusie
- `src/pages/api/leads/[id].ts` — API route (PUT):
  1. Walidacja seller tokenu (z headera lub query param)
  2. Update `call_log`: status + komentarz
  3. Zwroc 200

### Weryfikacja
- Dodaj test sellera do D1: `INSERT INTO sellers (name, telegram_chat_id, token) VALUES ('Jan', '123', 'test-token-abc')`
- `curl http://localhost:4321/s/test-token-abc` → strona z lista leadow
- `curl -X PUT http://localhost:4321/api/leads/1 -d '{"status":"called","comment":"nie odbiera"}'` → 200
- Odswierz panel → status zmieniony

### Dokumentacja
- [Astro server endpoints](https://docs.astro.build/en/guides/endpoints/#server-endpoints-api-routes)
- [Astro middleware](https://docs.astro.build/en/guides/middleware/)
- [D1 prepared statements](https://developers.cloudflare.com/d1/build-with-d1/d1-client-api/)

---

## Etap 7: Powiadomienia Telegram

Bot wysylajacy codzienny raport do sprzedawcy.

### Zadania
- Utworzyc bota: `/newbot` w BotFather → token jako CF secret
- `src/lib/telegram.ts`:
  1. `sendMessage` + `sendDailyReport` z formatowaniem DailyReport
  2. Tresc: ile nowych leadow, ile firm przeszukano, ile bez www
  3. Deep link do panelu: `[Otworz panel →](https://wizytowka.link/s/{token})`
  4. Max 4096 znakow — jesli wiecej, skroc do top 5 + summary
- Wywolanie na koncu cron scraper (Etap 4) po zapisaniu wynikow
- Sprzedawca musi napisac `/start` do bota zeby uzyskac `chat_id`
- Endpoint `src/pages/api/telegram/webhook/[secret].ts` — obsluga `/start` → zapisz `chat_id` do `sellers`

### Weryfikacja
- Wyslij testowa wiadomosc: `curl "https://api.telegram.org/bot{TOKEN}/sendMessage?chat_id={ID}&text=test"`
- Uruchom pelny cron scraper → sprawdz czy przyszla wiadomosc na Telegramie
- Kliknij deep link w wiadomosci → otwiera panel sprzedawcy

### Dokumentacja
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [BotFather tutorial](https://core.telegram.org/bots/tutorial)
- [Telegram sendMessage](https://core.telegram.org/bots/api#sendmessage)
- [Telegram webhooks](https://core.telegram.org/bots/api#setwebhook)

---

## Etap 8: Deploy + domena

Produkcyjny deploy na wizytowka.link.

### Zadania
- Kupic `wizytowka.link` na Cloudflare Registrar
- Custom domain w `wrangler.jsonc`:
  ```jsonc
  "routes": [
    { "pattern": "wizytowka.link", "custom_domain": true }
  ]
  ```
- Ustawic secrets: `wrangler secret put SERP_API_KEY`, `TELEGRAM_BOT_TOKEN`
- `wrangler deploy`
- Ustawic Telegram webhook: `https://api.telegram.org/bot{TOKEN}/setWebhook?url=https://wizytowka.link/api/telegram/webhook/{SECRET}`
- Dodac sellera do D1 (jednorazowo)
- Uruchomic pelny flow: geocoder → scraper → generator → telegram → panel

### Dodatkowe strony
- `src/pages/index.astro` — strona glowna
- `src/pages/polityka-prywatnosci.astro` — polityka prywatnosci
- `src/pages/regulamin.astro` — regulamin
- `src/pages/api/contact.ts` — formularz kontaktowy

### Weryfikacja
- `curl https://wizytowka.link/s/{token}` → panel sprzedawcy
- Telegram: przychodzi wiadomosc z linkiem
- `curl https://wizytowka.link/{loc}/{slug}` → strona firmy
- Nastepnego dnia o 8:00: nowe leady pojawiaja sie automatycznie

### Dokumentacja
- [CF Registrar](https://developers.cloudflare.com/registrar/)
- [CF Custom Domains for Workers](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [Wrangler deploy](https://developers.cloudflare.com/workers/wrangler/commands/#deploy)
- [Wrangler secrets](https://developers.cloudflare.com/workers/wrangler/commands/#secret)
