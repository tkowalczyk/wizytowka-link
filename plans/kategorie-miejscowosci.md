# Plan: Podstrony miejscowości z widokiem kategorii

> Source PRD: [GitHub issue #14](https://github.com/tkowalczyk/wizytowka-link/issues/14)

## Architectural decisions

- **Architecture style**: Astro SSR na Cloudflare Workers — dynamiczne renderowanie przy każdym requescie z agresywnym cache'owaniem na CF Edge (`s-maxage=86400`)
- **Data model**: Bez zmian w schemacie D1. Kategorie derywowane z istniejącej kolumny `businesses.category` (wolny tekst z Google). Slugifikacja po stronie JS przy użyciu istniejącej funkcji `slugify()`
- **Key entities**: `localities` (slug miejscowości), `businesses` (category, slug, rating, site_generated), brak nowej tabeli
- **Routing**: Dedykowany prefix `/kategoria/` w URL kategorii eliminuje kolizje ze slugami firm. Nowa trasa: `/[loc]/kategoria/[category]`
- **Scope biznesów**: Wyłącznie `site_generated = 1` — na stronach kategorii i w linkach „pokaż innych"
- **Dopasowanie kategorii**: 2 zapytania D1 — najpierw pobierz wszystkie kategorie dla miejscowości, następnie dopasuj `slugify(category) === param` w JS, potem zapytaj o firmy po raw category string

---

## Phase 1: Strona kategorii

**User stories**: 2, 6, 7

### What to build

Nowa trasa `/[loc]/kategoria/[category]` renderuje listę firm z danej kategorii i miejscowości. Użytkownik wchodzi na URL, dostaje stronę z nagłówkiem (nazwa kategorii + miejscowości), listą firm posortowaną po ratingu (tytuł + adres jako link do wizytówki) oraz breadcrumbami (Strona główna → Ząbki → Hydraulik). Strona zwraca 404 jeśli miejscowość lub kategoria nie istnieje. Cache `public, max-age=3600, s-maxage=86400`. Structured data BreadcrumbList w `<head>`.

### Acceptance criteria

- [x] `GET /zabki/kategoria/hydraulik` zwraca 200 z listą firm kategorii „Hydraulik" z miejscowości Ząbki
- [x] Firmy posortowane rating DESC (najwyższy na górze)
- [x] Każda pozycja na liście to link do `/[loc]/[slug]` firmy
- [x] `GET /zabki/kategoria/nieistniejaca` zwraca 404
- [x] `GET /nieistniejaca-miejscowosc/kategoria/hydraulik` zwraca 404
- [x] Breadcrumbs: Strona główna → [nazwa miejscowości] → [nazwa kategorii]
- [x] Nagłówek `Cache-Control: public, max-age=3600, s-maxage=86400`

---

## Phase 2: Przebudowa strony miejscowości

**User stories**: 1, 5

### What to build

Strona `/[loc]` zamiast płaskiej listy wszystkich firm wyświetla grid kategorii. Każda karta kategorii pokazuje nazwę kategorii i liczbę firm (`site_generated = 1`) oraz jest linkiem do `/[loc]/kategoria/[slug]`. Hierachia nawigacji jest kompletna: miejscowość → kategoria → firma.

### Acceptance criteria

- [x] `GET /zabki` wyświetla grid kategorii zamiast listy firm
- [x] Każda kategoria pokazuje poprawną liczbę firm (`site_generated = 1`)
- [x] Kliknięcie w kategorię prowadzi do strony z Fazy 1
- [x] Strona wyświetla się poprawnie gdy miejscowość ma 0 kategorii (komunikat zastępczy)
- [x] Kategoria z 1 firmą jest widoczna (brak progu minimalnego)

---

## Phase 3: Link „pokaż innych" na stronie biznesu

**User stories**: 3

### What to build

Na istniejącej stronie firmy (`/[loc]/[slug]`) dodać link „Pokaż innych [kategoria] z [miejscowość]" prowadzący do `/[loc]/kategoria/[cat-slug]`. Link pojawia się zawsze (kategoria zawsze istnieje jeśli strona firmy istnieje).

### Acceptance criteria

- [x] Strona firmy zawiera link „Pokaż innych [kategoria] z [miejscowość]"
- [x] Link prowadzi do poprawnego URL `/[loc]/kategoria/[slugify(category)]`
- [x] Link jest widoczny i dostępny (nie wymaga JS)

---

## Phase 4: Sitemap

**User stories**: 4

### What to build

Rozszerzyć `sitemap.xml` o URLe stron kategorii. Dla każdej unikalnej pary `(loc_slug, slugify(category))` z biznesów `site_generated = 1` dodać wpis z `priority=0.6`.

### Acceptance criteria

- [x] `GET /sitemap.xml` zawiera URLe w formacie `/[loc]/kategoria/[cat-slug]`
- [x] Brak duplikatów (ta sama para loc+category pojawia się raz)
- [x] Priority kategorii to `0.6` (niżej niż firmy: `0.7`, wyżej lub równo miejscowościom)
- [ ] Nowe URLe są poprawne — każdy zwraca 200 gdy wejść z sitemapy
