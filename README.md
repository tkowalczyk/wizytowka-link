# wizytowka.link

Automatyczna platforma, ktora znajduje lokalne firmy w Polsce bez strony internetowej — i tworzy im ja za darmo.

## Problem

Tysiace malych firm w Polsce — hydraulikow, fryzjerow, piekarni, warsztatow — nie ma zadnej obecnosci w internecie. Klienci ich nie znajduja, a firmy tracą zlecenia. Wlasciciele czesto nie wiedza jak zalozyc strone albo nie maja na to budzetu.

## Rozwiazanie

**wizytowka.link** codziennie automatycznie:

1. **Przeszukuje kolejna miejscowosc** w Polsce przez Google Maps (startujac od okolic Warszawy, rozszerzajac sie koncentrycznie)
2. **Znajduje firmy bez strony www** — ale z numerem telefonu i wizytowka na Mapach
3. **Generuje dla kazdej firmy prosta strone wizytowkowa** z AI — z nazwa, adresem, telefonem, opisem uslug i wezwaniem do kontaktu
4. **Powiadamia sprzedawce na Telegramie** — "Znaleziono 12 nowych firm bez strony w Legionowie. Otworz panel."

Sprzedawca otwiera panel, widzi liste firm z telefonami, dzwoni i proponuje: "Zrobilismy Panu strone — jest juz pod wizytowka.link/legionowo/hydraulik-kowalski. Chce Pan ja zatrzymac?"

## Korzysci dla malych firm

- **Natychmiastowa widocznosc w sieci** — strona gotowa zanim firma o niej wie
- **Zero wysilku** — firma nie musi nic robic, strona powstaje automatycznie
- **Profesjonalny wyglad** — responsywna strona z kolorystyka dopasowana do branzy
- **Lepsze SEO lokalne** — strona z adresem i kategoria pomaga w wyszukiwarkach
- **Darmowy start** — strona jest gotowa do pokazania, bez zadnych kosztow wstepnych

## Jak to dziala

```
   Co godzine        Codziennie 7:55    Codziennie 8:00    Co 5 minut       Pon 9:00
┌─────────────┐    ┌──────────────┐   ┌──────────────┐   ┌──────────────┐  ┌──────────────┐
│  Geocoder   │    │  Preflight   │   │  Discovery   │   │  Generator   │  │   Funnel     │
│ (GPS miast) │    │ (SerpAPI     │──▶│ (firmy       │──▶│ (strony      │  │ (tygodniowy  │
│             │    │  quota check)│   │  z Maps)     │   │  przez GLM-5)│  │  raport TG)  │
└─────────────┘    └──────────────┘   └──────┬───────┘   └──────┬───────┘  └──────┬───────┘
                                             │                   │                 │
                                             ▼                   ▼                 ▼
                                    ┌────────────────┐  ┌─────────────────┐ ┌──────────────┐
                                    │   Telegram     │  │  wizytowka.link │ │  Sellers     │
                                    │  (3 boty:      │  │  /miasto/firma  │ │ (statystyki  │
                                    │  seller/notify/│  │  (strona firmy) │ │  konwersji)  │
                                    │  client)       │  └─────────────────┘ └──────────────┘
                                    └────────────────┘
                                             │
                                    ┌────────────────┐
                                    │   Cron Log     │
                                    │  (historia     │
                                    │  uruchomien)   │
                                    └────────────────┘
```

**Geocoder** — co godzine nadaje wspolrzedne GPS kolejnym miejscowosciom z bazy ~95 tysiecy polskich miejscowosci (rejestr TERYT). Przy bledach stosuje exponential backoff zamiast permanentnego oznaczania jako failed.

**Preflight** — codziennie o 7:55, 5 minut przed discovery, sprawdza pozostala quote SerpAPI. Jesli ponizej progu (`DISCOVERY_MIN_QUOTA`), ustawia flage w KV ktora discovery respektuje i bailuje bez spalania ani jednego calla. Zabezpieczenie przed wyczerpaniem pakietu w srodku dnia.

**Discovery** — codziennie rano przeszukuje nastepna miejscowosc w 18 kategoriach (hydraulik, fryzjer, dentysta, piekarnia...). Zapisuje firmy ktore maja telefon ale nie maja strony www. Port-based DI umozliwia testowanie bez SerpAPI.

**Generator** — co 5 minut bierze nowe firmy i przez Z.ai GLM-5 generuje tresc strony wizytowkowej (nazwa, opis uslug, wezwanie do kontaktu). Strona jest natychmiast dostepna pod adresem `wizytowka.link/{miasto}/{firma}`.

**Panel sprzedawcy** — lista leadow z telefonami, komentarzami i 7-stopniowym lejkiem statusow (pending → called → interested / rejected / no_answer → meeting_set → deal_closed). Dostepny przez prywatny link.

**Telegram** — 3 osobne boty: seller (rejestracja + raporty), notify (powiadomienia o nowych leadach), client (edycja wizytowek przez wlascicieli firm). Codzienny raport zawiera statystyki discovery + stan zdrowia cronow.

**Funnel report** — w kazdy poniedzialek o 9:00 sprzedawcy dostaja przez Telegram tygodniowe podsumowanie lejka: ile leadow w kazdym z 7 statusow, konwersja od pending do deal_closed.

**Cron Log** — kazde uruchomienie crona jest rejestrowane w D1 (start/complete/fail + metryki). Dostepne przez API (`/api/cron-log`) i wlaczone w raport Telegramowy.

## Local dev

```bash
pnpm install
pnpm seed        # wipe local D1+R2, run migrations, seed test data
pnpm build && pnpm preview
pnpm test        # run 320+ tests (vitest + cloudflare pool)
```

Seed tworzy miejscowosc, 6 firm z wizytowkami, 2 sprzedawcow i logi kontaktow. Panel sprzedawcy: `http://localhost:8787/s/seller_jan_token?status=all`

**Uwaga o cronach:** `pnpm dev` (Astro dev server) nie odpala scheduled handlerow. Zeby testowac crony lokalnie uzyj `pnpm preview` (wrangler dev) i wywolaj:

```bash
curl "http://localhost:8787/cdn-cgi/handler/scheduled"
```

## Admin endpoints

Do recznego odpalenia konkretnego crona na produkcji (np. zeby wymusic `discovery` po podbiciu pakietu SerpAPI bez czekania do 8:00) sluzy chroniony endpoint:

```bash
POST /api/admin/run-cron/{name}
```

Gdzie `name` to jedna z: `geocoder`, `preflight`, `discovery`, `generate`. Kazdy uruchamia dokladnie ten sam handler co odpowiadajacy mu cron — logowany do `cron_log` jak normalne uruchomienie harmonogramowe.

**Autoryzacja:** naglowek `x-admin-token` musi rownac sie sekretowi `ADMIN_TOKEN` (ustawianemu przez `wrangler secret put ADMIN_TOKEN`). Brak sekretu = 500, zly token = 401.

**Uwaga o CSRF:** Astro 5 ma wlaczona ochrone `security.checkOrigin`, wiec curl musi dostac naglowek `Origin` pasujacy do domeny produkcyjnej:

```bash
curl -X POST https://wizytowka.link/api/admin/run-cron/discovery \
  -H "Origin: https://wizytowka.link" \
  -H "x-admin-token: $ADMIN_TOKEN"
```

Odpowiedz zwraca pelen `RunResult` z licznikami (`processed`, `failed`, `meta` — np. dla discovery `apiCalls`, `businesses`, `quotaExhausted`, `searchesLeft`).

## Stack

- Astro 5 SSR + Cloudflare Workers
- D1 (baza danych), R2 (pliki stron), KV (flagi preflight)
- SerpAPI (wyszukiwanie firm na Google Maps)
- Z.ai GLM-5 (generowanie tresci wizytowek)
- Telegram Bot API (3 boty: seller/notify/client)
- TailwindCSS 4 + system tematow (8 palet kolorow OKLCH, 3 style wizualne, 3 layouty, dark mode)
- Vitest + @cloudflare/vitest-pool-workers (260+ testow)
