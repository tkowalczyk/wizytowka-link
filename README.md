# wizytowka.link

Automatyczna platforma, która znajduje lokalne firmy w Polsce bez strony internetowej i tworzy dla nich niezależne wizytówki z asystentem AI.

## Problem

Tysiące małych firm w Polsce — hydraulików, fryzjerów, piekarni, warsztatów — nie ma żadnej obecności w internecie. Klienci ich nie znajdują, a firmy tracą zlecenia. Jednocześnie sama strona z publicznym telefonem wysyła odwiedzającego poza produkt i nie daje dobrego sygnału, czy wygenerowana wizytówka faktycznie tworzy popyt.

## Rozwiązanie

**wizytowka.link** codziennie automatycznie:

1. **Przeszukuje kolejną miejscowość** w Polsce przez Google Maps, startując od okolic Warszawy i rozszerzając zasięg koncentrycznie.
2. **Znajduje firmy bez strony www** — z danymi potrzebnymi do wewnętrznej kwalifikacji leadu i publicznym kontekstem lokalnym.
3. **Generuje niezależną wizytówkę** przez Z.ai GLM-5 — z nazwą, adresem, godzinami otwarcia, mapą, opisem i usługami.
4. **Ukrywa bezpośredni telefon, e-mail i link kontaktowy** w publicznym UI oraz danych strukturalnych, zachowując adres i godziny otwarcia.
5. **Udostępnia CTA „Zapytaj asystenta”**. Asystent odpowiada po polsku na podstawie danych wizytówki i bazy, jasno mówi, że nie reprezentuje bezpośrednio firmy, i nie podaje telefonu, e-maila ani bezpośrednich linków kontaktowych.
6. **Zapisuje rozmowy jako sygnał popytu** — sesje, wiadomości, podsumowanie intencji, liczbę wiadomości oraz kategorie takie jak rezerwacja, wycena, dostępność, reklamacja, praca i prośba o kontakt.
7. **Powiadamia operatora na Telegramie** o starcie i zakończeniu chatu, z linkiem do transkryptu w panelu.

Operator otwiera prywatny panel, widzi leady oraz dowody zainteresowania: transkrypty rozmów, chat start rate, liczbę wiadomości, powtarzający się popyt i reklamacje oddzielone od zapytań handlowych.

## Korzyści dla małych firm

- **Natychmiastowa widoczność w sieci** — wizytówka jest gotowa zanim firma zacznie projekt strony.
- **Zero wysiłku na start** — firma nie musi zakładać konta ani przygotowywać treści.
- **Profesjonalny wygląd** — responsywna strona z kolorystyką dopasowaną do branży.
- **Lepszy kontekst lokalny** — adres, godziny otwarcia, mapa i opis pomagają klientom szybko ocenić miejsce.
- **Asystent zamiast publicznego numeru** — odwiedzający mogą zadać pytanie bez opuszczania strony, a operator dostaje mierzalny sygnał zainteresowania.

## Jak to działa

```
┌──────────┐   ┌───────────┐   ┌───────────┐   ┌────────────┐
│Geocoder  │──▶│Preflight  │──▶│Discovery  │──▶│Generator   │
│GPS miast │   │quota check│   │firmy Maps │   │GLM-5       │
└──────────┘   └───────────┘   └─────┬─────┘   └─────┬──────┘
                                     │               │
                                     ▼               ▼
                              ┌────────────┐   ┌──────────────┐
                              │Telegram    │   │wizytowka.link│
                              │lead alerts │   │CTA asystenta │
                              └────────────┘   └──────┬───────┘
                                                       │
                                                       ▼
                         ┌──────────────┐      ┌──────────────┐
                         │Chat timeout  │◀────▶│Chat store    │
                         │co 10 minut   │      │sesje+wiadom. │
                         └──────┬───────┘      └──────┬───────┘
                                │                     │
                                ▼                     ▼
                         ┌──────────────┐      ┌──────────────┐
                         │Telegram      │      │Panel         │
                         │chat start/end│      │operatora     │
                         └──────────────┘      └──────────────┘
```

**Geocoder** — co godzinę nadaje współrzędne GPS kolejnym miejscowościom z bazy ~95 tysięcy polskich miejscowości (rejestr TERYT). Przy błędach stosuje exponential backoff zamiast permanentnego oznaczania jako failed.

**Preflight** — codziennie o 7:55, 5 minut przed discovery, sprawdza pozostałą quote SerpAPI. Jeśli jest poniżej progu (`DISCOVERY_MIN_QUOTA`), ustawia flagę w KV, którą discovery respektuje i kończy pracę bez spalania kolejnych calli. To zabezpiecza przed wyczerpaniem pakietu w środku dnia.

**Discovery** — codziennie rano przeszukuje następną miejscowość w 18 kategoriach (hydraulik, fryzjer, dentysta, piekarnia...). Zapisuje firmy, które kwalifikują się jako leady bez strony www. Port-based DI umożliwia testowanie bez SerpAPI.

**Generator** — co 5 minut bierze nowe firmy i przez Z.ai GLM-5 generuje treść wizytówki (nazwa, opis usług, lokalny kontekst, SEO). Publiczna strona jest dostępna pod adresem `wizytowka.link/{miasto}/{firma}`.

**Publiczna wizytówka** — nie pokazuje telefonu, e-maila ani bezpośredniego linku kontaktowego. Zachowuje adres, godziny otwarcia, mapę, opis i usługi, a główne działanie to przycisk **„Zapytaj asystenta”**.

**Asystent AI** — chat webowy z endpointami `POST /api/chat/start`, `POST /api/chat/messages` i `POST /api/chat/end`. Odpowiada tylko z dozwolonego kontekstu, nie podaje bezpośrednich danych kontaktowych, przechowuje transkrypt i kończy nieaktywne sesje przez scheduled sweep co 10 minut.

**Panel operatora** — lista leadów z telefonami do wewnętrznej pracy sprzedażowej, komentarzami i 7-stopniowym lejkiem statusów (pending → called → interested / rejected / no_answer → meeting_set → deal_closed). Panel pokazuje też transkrypty chatów, chat start rate, liczbę wiadomości, intencje szczegółowe, powtarzający się popyt i reklamacje.

**Telegram** — 3 osobne boty: seller (rejestracja + raporty), notify (powiadomienia o nowych leadach i chat start/end), client (edycja wizytówek przez właścicieli firm). Raporty zawierają statystyki discovery, lejek oraz stan zdrowia cronów.

**Funnel report** — w każdy poniedziałek o 9:00 operatorzy dostają przez Telegram tygodniowe podsumowanie lejka: ile leadów jest w każdym z 7 statusów i jaka jest konwersja od pending do deal_closed.

**Cron Log** — każde uruchomienie crona jest rejestrowane w D1 (start/complete/fail + metryki). Dostępne przez API (`/api/cron-log`) i włączone w raport Telegramowy.

## Local dev

```bash
pnpm install
pnpm seed        # wipe local D1+R2, run migrations, seed test data
pnpm build && pnpm preview
pnpm test        # run test suite (vitest + cloudflare pool)
```

Seed tworzy miejscowość, 6 firm z wizytówkami, 2 operatorów/sprzedawców, logi kontaktów oraz dane potrzebne do lokalnego panelu. Panel operatora: `http://localhost:8787/s/seller_jan_token?status=all`

**Uwaga o cronach:** `pnpm dev` (Astro dev server) nie odpala scheduled handlerów. Żeby testować crony lokalnie, użyj `pnpm preview` (wrangler dev) i wywołaj:

```bash
curl "http://localhost:8787/cdn-cgi/handler/scheduled"
```

## Admin endpoints

Do ręcznego odpalenia konkretnego crona na produkcji (np. żeby wymusić `discovery` po podbiciu pakietu SerpAPI bez czekania do 8:00) służy chroniony endpoint:

```bash
POST /api/admin/run-cron/{name}
```

Gdzie `name` to jedna z: `geocoder`, `preflight`, `discovery`, `generate`, `chatTimeout`, `funnel`. Każdy uruchamia dokładnie ten sam handler co odpowiadający mu cron — logowany do `cron_log` jak normalne uruchomienie harmonogramowe.

**Autoryzacja:** nagłówek `x-admin-token` musi równać się sekretowi `ADMIN_TOKEN` (ustawianemu przez `wrangler secret put ADMIN_TOKEN`). Brak sekretu = 500, zły token = 401.

**Uwaga o CSRF:** Astro 5 ma włączoną ochronę `security.checkOrigin`, więc curl musi dostać nagłówek `Origin` pasujący do domeny produkcyjnej:

```bash
curl -X POST https://wizytowka.link/api/admin/run-cron/discovery \
  -H "Origin: https://wizytowka.link" \
  -H "x-admin-token: $ADMIN_TOKEN"
```

Odpowiedź zwraca pełen `RunResult` z licznikami (`processed`, `failed`, `meta` — np. dla discovery `apiCalls`, `businesses`, `quotaExhausted`, `searchesLeft`).

## Stack

- Astro 5 SSR + Cloudflare Workers
- D1 (baza danych), R2 (pliki stron), KV (flagi preflight)
- SerpAPI (wyszukiwanie firm na Google Maps)
- Z.ai GLM-5 (generowanie treści wizytówek i odpowiedzi asystenta)
- Telegram Bot API (3 boty: seller/notify/client)
- TailwindCSS 4 + system motywów (8 palet kolorów OKLCH, 3 style wizualne, 3 layouty, dark mode)
- Vitest + @cloudflare/vitest-pool-workers
