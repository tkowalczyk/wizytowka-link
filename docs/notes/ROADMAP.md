# Roadmap

## 0. CTA Click Tracking

Inline JS beacon na statycznych stronach z R2. Zero wpływu na UX/SEO.

```js
document.querySelectorAll('a[href^="tel:"]').forEach(a =>
  a.addEventListener('click', () =>
    navigator.sendBeacon('/api/cta/' + BUSINESS_ID)))
```

- Endpoint `/api/cta/:id` → INSERT do D1
- Nowa tabela: `cta_clicks(id INTEGER PK, business_id INT, created_at TEXT, ua TEXT, referer TEXT)`
- Strona pozostaje statyczna — JS jest częścią szablonu Astro

---

## 1. Klaster SEO — 5-8 stron per biznes

### Typy stron w klastrze

| Typ | URL pattern | Target keyword | Źródło |
|-----|-------------|----------------|--------|
| Główna (istniejąca) | `/lodz/hydraulik-kowalski` | "hydraulik łódź kowalski" | obecny generator |
| Usługowa ×3-4 | `/lodz/hydraulik-kowalski/naprawa-rur` | "naprawa rur łódź" | AI per usługa |
| Cennikowa | `/lodz/hydraulik-kowalski/cennik` | "hydraulik łódź cennik" | AI branżowy cennik |
| FAQ | `/lodz/hydraulik-kowalski/faq` | "hydraulik łódź pytania" | AI z "People Also Ask" |
| Rejonowa | `/lodz/srodmiescie/hydraulik` | "hydraulik łódź śródmieście" | agregacja per dzielnica |

### Dane do podstron

SerpAPI already returns related_searches + People Also Ask — nie zapisujemy ich. Rozszerzamy scraper:
- related searches → slugi podstron usługowych
- people also ask → pytania FAQ
- local results → powiązane usługi w mieście

### R2 structure

```
sites/lodz/hydraulik-kowalski.json                ← istniejące
sites/lodz/hydraulik-kowalski/naprawa-rur.json     ← klaster
sites/lodz/hydraulik-kowalski/cennik.json
sites/lodz/hydraulik-kowalski/faq.json
sites/lodz/_category/hydraulicy.json               ← rejonowa
sites/lodz/srodmiescie/_category/hydraulicy.json   ← dzielnica
```

### Astro routing

```
src/pages/
  [loc]/[slug].astro                    ← istniejące
  [loc]/[slug]/[subpage].astro          ← podstrona klastra
  [loc]/[category].astro                ← strona rejonowa
  [loc]/[district]/[category].astro     ← dzielnica
```

Każda route: fetch z R2 → render → static response. Identyczny pattern jak teraz.

### Internal linking

Każda podstrona linkuje do:
- strony głównej biznesu (breadcrumb)
- innych podstron tego biznesu (sidebar/footer)
- stron rejonowych (agregacje per kategoria + dzielnica)
- raportów popytu (#2)

### Skala

1k biznesów × 6 stron = ~6k stron. 10k biznesów = ~60k stron. Koszt: R2 storage (grosze) + Workers AI generation (jednorazowy).

---

## 2. Proof of Demand — raporty popytu

### Idea

Publiczna strona-raport per kategoria × miasto. Podwójny cel:
1. **Lead magnet** — właściciel firmy trafia z Google, widzi swoją lukę
2. **Argument sprzedażowy** — sprzedawca wysyła link podczas rozmowy

### Przykład: `wizytowka.link/raport/hydraulik/lodz`

> **Popyt na hydraulików w Łodzi — Luty 2026**
>
> Wyszukiwania miesięcznie: ~2,400
> Top frazy: hydraulik łódź, hydraulik awaryjny łódź, naprawa rur łódź cennik...
>
> Firmy widoczne w Google (top 5):
> 1. Hydro-Max — poz #1, 47 opinii ★4.8
> 2. Rury24 — poz #2, Google Ads, 23 opinie ★4.2
>
> Luka: 8 firm z tej listy nie ma strony internetowej.
>
> [CTA: "Sprawdź swoją firmę"]

### Dane

| Dana | Źródło | Status |
|------|--------|--------|
| Firmy + pozycje | SerpAPI local results | ✅ już scrapujemy |
| Powiązane frazy | SerpAPI related_searches | ✅ w odpowiedzi, nie zapisujemy |
| People Also Ask | SerpAPI PAA | ✅ j.w. |
| Liczba wyników | SerpAPI total_results | ✅ j.w. |
| Opinie/rating | SerpAPI local results | ✅ w BusinessRow |
| Trend wyszukiwań | SerpAPI Google Trends | 🆕 dodatkowe query |
| Czy firma ma stronę | SerpAPI website field | ✅ scrapujemy |

### Nowa tabela

```sql
search_insights(
  id INTEGER PK,
  locality_id INT,
  category TEXT,
  related_searches TEXT,  -- JSON array
  people_also_ask TEXT,   -- JSON array
  total_results INT,
  scraped_at TEXT
)
```

### Generacja

Cron tygodniowy → per kategoria/miasto:
1. Agreguj search_insights + businesses z D1
2. Workers AI formatuje raport (PL)
3. JSON → R2: `reports/hydraulik/lodz.json`
4. Route: `/raport/[category]/[loc].astro` → fetch z R2 → render

Statyczna strona z R2, regenerowana raz/tydzień.

---

## Jak to się łączy

```
Google SERP
    ↓
[Raport Popytu] ← informational keywords
    ↓ linkuje do
[Strony Rejonowe] ← "hydraulicy łódź" (lista)
    ↓ linkuje do
[Wizytówka Główna] ← "hydraulik kowalski łódź"
    ↓ linkuje do
[Podstrony Klastra] ← "naprawa rur łódź cennik", FAQ
    ↓
[CTA tel: + beacon tracking]
```

Wewnętrzna sieć linków rośnie organicznie z każdym biznesem. Wszystko statyczne z R2.

---

## Otwarte pytania

1. SerpAPI quota — klaster ×6 = więcej queries na related/PAA, czy starczy?
2. Related searches + PAA — zapisywać przy obecnym cron czy osobny pass?
3. Raporty — od razu wszystkie kategorie × miasta, czy top 20 na start?
4. Strony rejonowe — dane dzielnic z TERYT czy mapować z geocodera?
5. Cennik na podstronach — branżowe średnie z AI, czy zbyt ryzykowne?
