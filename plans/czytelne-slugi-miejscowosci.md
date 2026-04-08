# Plan: Czytelne slugi miejscowości dla powtarzających się nazw

> Source PRD: tkowalczyk/wizytowka-link#19

## Architectural decisions

Durable decisions that apply across all phases:

- **Architecture style**: Cloudflare Workers + Astro 5 SSR + D1 + R2. Algorytm slugów to czysta biblioteka TypeScript bez runtime'owych zależności — uruchamiana w trakcie seedu i migracji, nigdy w hot-pathach produkcyjnych.
- **Data model**: Bez zmian schemy. Tabela `localities` ma już kolumny `name`, `slug`, `gmi_name`, `pow_name`, `woj_name`, `sym` — wszystko czego potrzebujemy. Tylko wartości `slug` są przepisywane.
- **Key entities**: `localities` (TERYT, ~95k wierszy z `sym = sym_pod`). Encje `businesses`, `leads`, `call_log`, `business_owners`, `sellers` referują `locality_id` (nie slug) i są nietknięte przez całą migrację.
- **Algorytm**: Hierarchicznie eskalujący two-pass: dla każdego z 4 poziomów (`name`, `name+gmi`, `name+gmi+pow`, `name+gmi+pow+woj`) liczymy zbiory kolizji; każda miejscowość dostaje slug na najniższym poziomie dającym jednoznaczność. Ostateczny fallback (krawędziowy edge case): sufiks `sym`.
- **Symetria**: Wszystkie miejscowości o powtarzającej się nazwie dostają sufiks (żadna nie jest „pierwsza w kolejce"). Eliminuje arbitralność wynikającą z porządku w CSV.
- **Etykieta UI**: Format pełny zawsze (`Brzezie, gm. Kłaj, pow. wielicki`), niezależnie od tego ile członów algorytm użył w slugu. Pojedynczy punkt prawdy w funkcji `locality-label`.
- **Scope UI tej iteracji**: Tylko nagłówek strony biznesu. Index miejscowości, strony kategorii, sitemap, llms.txt, telegram, LLM site-content — nietknięte.
- **Brak backward-compat**: R2 ma wygenerowane pliki, ale żaden URL nie jest zaindeksowany ani udostępniony. Brak redirectów 301, brak aliasów. Migracja R2 robi rename in-place (copy + delete).
- **Idempotentność**: Wszystkie skrypty migracyjne (D1 UPDATE driver, R2 rename) muszą być bezpiecznie wykonywalne wielokrotnie.

---

## Phase 1: Tracer bullet — happy path dla prostej kolizji

**User stories**: 1, 2, 5, 8, 9, 11, 12, 13

### What to build

End-to-end thin slice na minimalnej funkcjonalności algorytmu — tylko **poziom 1 eskalacji** (nazwa → +gmina). Cały pipeline złożony i działający lokalnie:

- Biblioteka `locality-slug` z uproszczonym algorytmem: jeśli nazwa jest unikatowa → goły slug; jeśli koliduje → dorzuca slug gminy. Bez eskalacji na powiat/woj. Z wyczerpującymi testami dla obsługiwanych przypadków.
- Biblioteka `locality-label` z pełnym formatem `"Nazwa, gm. Gmina, pow. powiat"` — od razu w docelowej wersji, ten interfejs nie zmienia się między fazami.
- Integracja z seedem TERYT: zastępuje obecną logikę kolizyjną (`globalSlugs` set + sufiks `-{sym}`) wywołaniem nowej biblioteki. Dodaje walidację FAIL-on-duplicate która zatrzymuje seed jeśli liczba unikalnych slugów ≠ liczba localities.
- Lokalne D1 zaseedowane przez `pnpm seed` na podzbiorze TERYT (lub fixturach) zawierającym co najmniej jedną parę kolidujących miejscowości w różnych gminach.
- Lokalne R2 regenerowane normalnym mechanizmem cron `generate-sites` — brak osobnego skryptu na tym etapie.
- Integracja UI: pojedyncze miejsce w komponencie strony biznesu woła `locality-label`. Jeden tracer-punkt dotknięcia.

### Acceptance criteria

- [ ] Biblioteka `locality-slug` (uproszczona, poziom 1) ma testy pokrywające: brak kolizji, prosta kolizja 2-way, kolizja 3-way (2+1 w dwóch gminach), wszystkie zielone
- [ ] Biblioteka `locality-label` ma testy weryfikujące pełny format z polskimi znakami
- [ ] `pnpm seed` na lokalnym D1 przechodzi czysto bez warningów o duplikatach
- [ ] Wstrzyknięcie sztucznych duplikatów do wejścia powoduje że seed FAIL'uje z czytelnym błędem (test walidacji)
- [ ] Po `pnpm dev` w przeglądarce: dwie kolidujące miejscowości mają czytelne URL-e (`/brzezie-klaj/...`, `/brzezie-mosina/...`), żadnego sufiksu `-{sym}`
- [ ] Na stronie biznesu (`/[loc]/[slug]`) nagłówek pokazuje pełny format etykiety zarówno dla kolidujących jak i unikatowych miejscowości
- [ ] Strony index miejscowości (`/[loc]`) i kategorii (`/[loc]/kategoria/[cat]`) zachowują dotychczasowe zachowanie (regression — bez doprecyzowania)
- [ ] Żadna z tabel `businesses`, `leads`, `call_log`, `business_owners`, `sellers` nie ma zmienionej schemy ani danych

---

## Phase 2: Pełna eskalacja algorytmu

**User stories**: 5, 9 (rozszerzenie z Fazy 1)

### What to build

Rozszerzenie biblioteki `locality-slug` o pełną hierarchię eskalacji bez dotykania innych komponentów. Interfejs biblioteki nie zmienia się — pipeline z Fazy 1 dziedziczy nowe zachowanie automatycznie.

- Poziom 2: gdy kolizja występuje również na `name+gmi`, dorzucamy powiat (`brzezie-klaj-wielicki`).
- Poziom 3: gdy kolizja na `name+gmi+pow`, dorzucamy województwo.
- Poziom 4: ostateczny fallback `sym` dla absolutnych edge cases (powinno być skrajnie rzadkie lub puste).
- Wyczerpujące testy jednostkowe pokrywające wszystkie 4 poziomy + property test sprawdzający że dla pełnego TERYT liczba unikalnych slugów = liczba localities.
- Logging w trakcie seedu: rozkład ile slugów wylądowało na każdym z 4 poziomów. Daje empiryczny obraz częstotliwości kolizji w polskim TERYT.

### Acceptance criteria

- [ ] Test eskalacji do poziomu 2 (gmina+powiat) zielony
- [ ] Test eskalacji do poziomu 3 (gmina+powiat+woj) zielony
- [ ] Test ostatecznego fallbacku `sym` zielony
- [ ] Property test: dla syntetycznego pełnego zbioru wejściowego liczba unikalnych slugów = liczba wierszy
- [ ] Test deterministyczności: dwukrotne uruchomienie algorytmu na tym samym wejściu daje identyczne wyjście
- [ ] `pnpm seed` na pełnym TERYT (~95k localities) przechodzi czysto z walidacją zieloną
- [ ] Log z seedu pokazuje rozkład eskalacji (ile slugów na każdym poziomie 1/2/3/4)
- [ ] Lokalne wyklikanie miejscowości która eskalowała na poziom 2 lub 3 — strona działa, etykieta poprawna

---

## Phase 3: Migracja produkcyjna + smoke test

**User stories**: 3, 4, 6, 7, 10, 14

### What to build

Operacyjny rollout: dwa idempotentne skrypty migracji + e2e smoke test, następnie deployment.

- **Migracja D1**: skrypt-driver w TypeScript który odczytuje produkcyjny stan `localities`, wylicza nowe slugi przez bibliotekę z Faz 1+2, generuje paczki UPDATE'ów respektujące limit 100 paramów D1 (~50 wierszy per batch), wykonuje sekwencyjnie przez `wrangler d1 execute`. Idempotentny: jeśli `slug` już ma wartość docelową, UPDATE jest no-opem (lub jest pomijany w generowaniu).
- **Migracja R2**: skrypt który listuje wszystkie klucze pod prefiksem `sites/`, mapuje stary slug miejscowości na nowy, kopiuje plik pod nowy klucz, kasuje stary. Obsługuje zarówno `sites/...` (live) jak i `sites/draft/...`. Idempotentny: skip jeśli target istnieje, skip jeśli source nieistniejący. Bezpieczny do wznowienia po przerwaniu.
- **E2E smoke test**: po wykonaniu obu migracji na środowisku stagingowym lub lokalnym wypełnionym produkcyjnymi fixturami, pobiera 10 losowych biznesów z mieszanką kolidujących i unikatowych miejscowości. Dla każdego: weryfikuje że nowy URL zwraca 200 z poprawnym nagłówkiem, stary URL zwraca 404.
- **Deployment**: kolejność produkcyjna: D1 migration → R2 migration → smoke test → opcjonalnie wyzwolenie cron `generate-sites` aby wszystko świeże. Brak okna pustki, brak utraty plików.

### Acceptance criteria

- [ ] Skrypt migracji D1 uruchomiony na lokalnym D1 ze sztucznymi starymi slugami `-{sym}` zaktualizował wszystkie wiersze do nowego formatu
- [ ] Drugie uruchomienie skryptu D1 = 0 zmian (test idempotentności)
- [ ] Po migracji D1 żadna kolumna w `businesses`, `leads`, `call_log`, `business_owners`, `sellers` nie jest dotknięta (regression check)
- [ ] Skrypt migracji R2 uruchomiony na lokalnym R2 — wszystkie pliki dostępne pod nowymi kluczami, żaden plik nie zniknął
- [ ] Drugie uruchomienie skryptu R2 = 0 operacji (idempotentność)
- [ ] Test wznowienia: przerwanie skryptu R2 w połowie i ponowne uruchomienie kończy migrację bez utraty plików
- [ ] Skrypt R2 obsłużył oba prefiksy: `sites/` (live) i `sites/draft/`
- [ ] E2E smoke test: 10 losowych biznesów, wszystkie nowe URL = 200, wszystkie stare = 404, nagłówki zawierają nowy format etykiety
- [ ] Wdrożenie produkcyjne wykonane w kolejności D1 → R2 → smoke, bez błędów
- [ ] Po wdrożeniu losowo wybrany biznes z popularnie nazwanej miejscowości ma czytelny URL i pełną etykietę w nagłówku
