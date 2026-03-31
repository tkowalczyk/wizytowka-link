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
   Co godzine              Codziennie o 8:00         Co 5 minut
┌─────────────┐       ┌──────────────────┐      ┌─────────────────┐
│  Geocoder   │──────▶│   Discovery      │─────▶│   Generator     │
│ (GPS miast) │       │ (firmy z Maps)   │      │ (strony z AI)   │
└─────────────┘       └───────┬──────────┘      └────────┬────────┘
                              │                          │
                              ▼                          ▼
                     ┌────────────────┐        ┌─────────────────┐
                     │   Telegram     │        │  wizytowka.link │
                     │  (3 boty:      │        │  /miasto/firma   │
                     │  seller/notify/│        │  (strona firmy)  │
                     │  client)       │        └─────────────────┘
                     └────────────────┘
                              │
                     ┌────────────────┐
                     │   Cron Log     │
                     │  (historia     │
                     │  uruchomien)   │
                     └────────────────┘
```

**Geocoder** — co godzine nadaje wspolrzedne GPS kolejnym miejscowosciom z bazy ~95 tysiecy polskich miejscowosci (rejestr TERYT). Przy bledach stosuje exponential backoff zamiast permanentnego oznaczania jako failed.

**Discovery** — codziennie rano przeszukuje nastepna miejscowosc w 18 kategoriach (hydraulik, fryzjer, dentysta, piekarnia...). Zapisuje firmy ktore maja telefon ale nie maja strony www. Port-based DI umozliwia testowanie bez SerpAPI.

**Generator** — co 5 minut bierze nowe firmy i za pomoca AI generuje tresc strony wizytowkowej. Strona jest natychmiast dostepna pod adresem `wizytowka.link/{miasto}/{firma}`.

**Panel sprzedawcy** — lista leadow z telefonami, statusami kontaktu i komentarzami. Dostepny przez prywatny link.

**Telegram** — 3 osobne boty: seller (rejestracja + raporty), notify (powiadomienia o nowych leadach), client (edycja wizytowek przez wlascicieli firm). Codzienny raport zawiera statystyki discovery + stan zdrowia cronow.

**Cron Log** — kazde uruchomienie crona jest rejestrowane w D1 (start/complete/fail + metryki). Dostepne przez API (`/api/cron-log`) i wlaczone w raport Telegramowy.

## Local dev

```bash
pnpm install
pnpm seed        # wipe local D1+R2, run migrations, seed test data
pnpm build && pnpm preview
pnpm test        # run 150+ tests (vitest + cloudflare pool)
```

Seed tworzy miejscowosc, 6 firm z wizytowkami, 2 sprzedawcow i logi kontaktow. Panel sprzedawcy: `http://localhost:8787/s/seller_jan_token?status=all`

## Stack

- Astro 5 SSR + Cloudflare Workers
- D1 (baza danych), R2 (pliki stron)
- SerpAPI (wyszukiwanie firm na Google Maps)
- Workers AI (generowanie tresci)
- Telegram Bot API (3 boty: seller/notify/client)
- TailwindCSS 4 + system tematow (8 palet kolorow OKLCH, 3 style wizualne, 3 layouty, dark mode)
- Vitest + @cloudflare/vitest-pool-workers (150+ testow)
