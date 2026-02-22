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
│  Geocoder   │──────▶│    Scraper       │─────▶│   Generator     │
│ (GPS miast) │       │ (firmy z Maps)   │      │ (strony z AI)   │
└─────────────┘       └───────┬──────────┘      └────────┬────────┘
                              │                          │
                              ▼                          ▼
                     ┌────────────────┐        ┌─────────────────┐
                     │   Telegram     │        │  wizytowka.link │
                     │  (powiadomienie│        │  /miasto/firma   │
                     │  do sprzedawcy)│        │  (strona firmy)  │
                     └────────────────┘        └─────────────────┘
```

**Geocoder** — co godzine nadaje wspolrzedne GPS kolejnym miejscowosciom z bazy ~95 tysiecy polskich miejscowosci (rejestr TERYT).

**Scraper** — codziennie rano przeszukuje nastepna miejscowosc w 18 kategoriach (hydraulik, fryzjer, dentysta, piekarnia...). Zapisuje firmy ktore maja telefon ale nie maja strony www.

**Generator** — co 5 minut bierze nowe firmy i za pomoca AI generuje tresc strony wizytowkowej. Strona jest natychmiast dostepna pod adresem `wizytowka.link/{miasto}/{firma}`.

**Panel sprzedawcy** — lista leadow z telefonami, statusami kontaktu i komentarzami. Dostepny przez prywatny link.

**Telegram** — codzienny raport ile nowych firm znaleziono, z linkiem do panelu.

## Stack

- Astro 5 SSR + Cloudflare Workers
- D1 (baza danych), R2 (pliki stron)
- SerpAPI (wyszukiwanie firm na Google Maps)
- Workers AI (generowanie tresci)
- Telegram Bot API (powiadomienia)
- TailwindCSS (stylowanie stron)
