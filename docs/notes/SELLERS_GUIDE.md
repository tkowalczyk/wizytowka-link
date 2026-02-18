# Przewodnik sprzedawcy -- wizytowka.link

## Czym jest system

wizytowka.link to platforma lead-gen. System automatycznie wyszukuje polskie firmy lokalne, ktore **nie maja strony internetowej**, i generuje dla nich darmowe wizytowki (strony internetowe). Twoim zadaniem jako sprzedawcy jest kontaktowanie sie z tymi firmami i oferowanie im ich strony.

**Twoj cel**: zadzwon do firmy, poinformuj o gotowej stronie, i zamknij sprzedaz.

Firmy w systemie to firmy ktore:
- sa zarejestrowane w Google Maps
- maja numer telefonu
- NIE maja wlasnej strony internetowej

To sa idealni kandydaci -- potrzebuja obecnosci w internecie, ale jeszcze jej nie maja.

---

## Panel sprzedawcy

### Dostep

Panel jest dostepny pod adresem:

```
https://wizytowka.link/s/{TWOJ_TOKEN}
```

Token dostajesz od administratora. Jest unikalny -- nie udostepniaj go nikomu. Token w URL = dostep do panelu, nie ma dodatkowego logowania.

**Wazne**: dodaj ten link do zakladek w przegladarce. Dziala rowniez na telefonie.

### Co widac w panelu

Po otwarciu panelu widzisz:
- **Naglowek**: twoje imie + laczna liczba leadow
- **Filtry statusu**: przyciski do filtrowania leadow wg statusu
- **Filtr miejscowosci**: rozwijana lista z miejscowosciami
- **Sortowanie**: wg daty (domyslne) lub wg statusu
- **Lista leadow**: karty z danymi firm, 50 na strone
- **Paginacja**: nawigacja miedzy stronami

### Karta leada

Kazdy lead (firma) wyswietla:
- **Nazwa firmy** + ocena Google (jesli jest)
- **Adres**
- **Kategoria** (np. fryzjer, mechanik, piekarnia)
- **Miejscowosc**
- **Data dodania**
- **Numer telefonu** -- kliknij zeby zadzwonic (na telefonie otwiera dialer)
- **Link do strony** -- "Strona" (jesli wygenerowana) lub "Brak strony" (jesli jeszcze nie)
- **Status** -- rozwijana lista do zmiany statusu
- **Komentarz** -- pole tekstowe + przycisk "Zapisz"

---

## Statusy leadow

Kazdy lead ma jeden z czterech statusow:

| Status | Znaczenie | Kiedy uzyc |
|---|---|---|
| **Oczekujacy** | Domyslny, jeszcze nie kontaktowany | Nowy lead |
| **Zadzwoniono** | Proba kontaktu | Zadzwoniles, ale nie ma decyzji |
| **Zainteresowany** | Firma chce strone | Klient potwierdza zainteresowanie |
| **Odrzucony** | Niezainteresowana | Firma odmawia |

### Jak zmienic status

1. Znajdz leada w panelu
2. Wybierz nowy status z rozwijalnej listy
3. Status zapisuje sie automatycznie (bez odswiezania strony)
4. Znaczek statusu obok zmieni kolor na potwierdzenie

### Jak dodac komentarz

1. Wpisz tekst w pole "Komentarz..."
2. Kliknij "Zapisz"
3. Przycisk zmieni sie na "Zapisano!" na 1.5 sekundy
4. Komentarz jest widoczny przy nastepnym otwarciu panelu

**Uwaga**: zmiana statusu tworzy nowy wpis w historii kontaktow. Edycja komentarza (bez zmiany statusu) aktualizuje istniejacy wpis. Cala historia jest zachowana.

---

## Filtrowanie i sortowanie

### Filtr statusu

Kliknij przycisk u gory panelu:
- **Wszystkie** -- wszystkie leady
- **Oczekujacy** -- nieobdzwonione (zacznij od tych)
- **Zadzwoniono** -- w trakcie
- **Zainteresowany** -- do dalszej obslugi
- **Odrzucony** -- zamkniete

### Filtr miejscowosci

Wybierz miejscowosc z rozwijalnej listy. "Wszystkie miejscowosci" pokazuje wszystko.

### Sortowanie

- **Wg daty** -- najnowsze firmy na gorze
- **Wg statusu** -- grupowanie po statusie

Filtry mozna laczyc. Np. pokaz tylko "Oczekujacych" z konkretnej miejscowosci.

---

## Powiadomienia Telegram

### Konfiguracja (jednorazowa)

1. Otrzymujesz od administratora link rejestracyjny:
   ```
   https://t.me/wizytowka_link_bot?start={TWOJ_TOKEN}
   ```
2. Kliknij link -- otworzy sie Telegram z botem
3. Telegram automatycznie wysle komende `/start` z twoim tokenem
4. Bot odpowie: **"Zarejestrowano! Bedziesz otrzymywac codzienne raporty."**

Gotowe. Nie musisz nic wiecej konfigurowac.

**Rozwiazywanie problemow**:
- "Nieprawidlowy token" -- skontaktuj sie z administratorem, token moze byc bledny
- "Juz jestes zarejestrowany" -- wszystko OK, juz masz powiadomienia
- "Uzyj linku rejestracyjnego od administratora" -- nie wpisuj `/start` recznie, uzyj pelnego linku

### Co zawiera raport dzienny

Raport przychodzi codziennie po zakonczeniu skanowania (ok. godzina 10:00). Zawartosc:

```
Raport dzienny -- 2026-02-18

Przeszukano: Stanislawow Pierwszy
Znaleziono firm: 47
Nowych leadow (bez www): 12

Top leady:
1. Zaklad Stolarski Kowalski -- stolarz -- +48 600 123 456
2. Piekarnia u Zosi -- piekarnia -- +48 601 234 567
3. Auto Serwis Nowak -- mechanik -- +48 602 345 678
...i 9 wiecej

Otworz panel ->
```

- **Przeszukano** -- ktora miejscowosc system dzis przeszukal
- **Znaleziono firm** -- ile firm w tej miejscowosci
- **Nowych leadow (bez www)** -- firmy bez strony z telefonem (twoje leady)
- **Top leady** -- 5 najnowszych leadow z nazwa, kategoria i telefonem
- **Otworz panel** -- link prosto do twojego panelu

### Powiadomienia z formularza kontaktowego

Gdy ktos wypelni formularz kontaktowy na stronie wizytowka.link, otrzymasz powiadomienie Telegram z numerem telefonu osoby kontaktujacej. Oddzwon jak najszybciej.

---

## Proces kontaktu z klientem

### Krok po kroku

1. **Otworz panel** -- filtruj po "Oczekujacy"
2. **Wybierz leada** -- sprawdz nazwe, kategorie, adres
3. **Sprawdz strone** -- jesli jest link "Strona", otworz go. Bedziesz o niej mowic
4. **Zadzwon** -- kliknij numer telefonu (zielony przycisk)
5. **Zmien status na "Zadzwoniono"** -- od razu po polaczeniu
6. **Dodaj komentarz** -- np. "nie odbiera", "oddzwonic po 15", "rozmawialem z wlascicielem"
7. **Po decyzji** -- zmien na "Zainteresowany" lub "Odrzucony"

### Co mowic

Przykladowe otwarcie rozmowy:

> "Dzien dobry, dzwonie z wizytowka.link. Przygotowalismy dla Panstwa darmowa strone internetowa z Waszymi danymi kontaktowymi. Strona juz jest dostepna w Google. Czy moglibysmyporozmawiac o tym, jak mozemy ja rozbudowac?"

Kluczowe argumenty:
- Strona **juz istnieje** i jest widoczna w Google
- Zawiera dane firmy: adres, telefon, kategorie
- Firmy bez strony traca klientow szukajacych w internecie
- Mozliwosc rozbudowy strony o dodatkowe uslugi

---

## Logowanie kontaktow (call_log)

System prowadzi pelna historie kontaktow. Kazda zmiana statusu = nowy wpis w logu z:
- data i godzina
- ktory sprzedawca
- jaki status
- komentarz (opcjonalny)

**Dlaczego to wazne**:
- Nie tracisz informacji o wczesniejszych kontaktach
- Mozesz sprawdzic co mowiles ostatnio
- Administrator widzi postepy pracy

**Praktycznie**: za kazdym razem gdy dzwonisz do firmy, zmien status i zostaw komentarz. Nawet krotki: "nie odbiera", "zajety", "oddzwonic jutro".

---

## Najlepsze praktyki

### Organizacja pracy

- **Zacznij od "Oczekujacych"** -- to sa swieze leady, wieksze szanse na kontakt
- **Pracuj miejscowosciami** -- ustaw filtr na jedna miejscowosc i przejdz ja cala
- **Raporty Telegram to twoj poranny brief** -- sprawdzaj je codziennie, by wiedziec co nowego
- **Oznaczaj od razu** -- zmien status zaraz po rozmowie, nie odkładaj na pozniej

### Dzwonienie

- **Dzwon w godzinach pracy** -- 9:00-17:00, unikaj poniedzialku rano i piatku po poludniu
- **Nie odbiera** -- zmien na "Zadzwoniono", komentarz "nie odbiera", sprobuj nastepnego dnia
- **Krotkie rozmowy** -- przedstaw sie, powiedz o stronie, zapytaj o zainteresowanie. Szczegoly w kolejnym kontakcie

### Komentarze

Zostawiaj uzyteczne komentarze. Przyklady:

- `nie odbiera x2, sprobowac po 15`
- `rozmawialem z zona wlasciciela, oddzwonic w piatek`
- `zainteresowany, chce dodatkowe zdjecia na stronie`
- `odmowa - ma juz strone u innego dostawcy`
- `numer nieaktualny`

### Strony firm

- Jesli lead ma przycisk **"Strona"** -- otworz ja przed rozmowa. Bedziesz wiedzial co na niej jest
- Jesli lead ma **"Brak strony"** -- strona jeszcze nie zostala wygenerowana. Mozesz mowic ze "przygotowujemy strone"
- Link do strony firmy: `https://wizytowka.link/{miejscowosc}/{firma}`

### Telefon vs komputer

- **Telefon** -- lepszy do dzwonienia (kliknij numer = polaczenie). Filtry i statusy dzialaja na mobile
- **Komputer** -- lepszy do przegladania listy i planowania dnia

---

## FAQ

**Czy moge widziec leady innych sprzedawcow?**
Wszyscy sprzedawcy widza te same leady. Twoja historia kontaktow (statusy, komentarze) jest tylko twoja.

**Co jesli firma juz ma strone?**
System filtruje firmy bez stron. Jesli mimo to trafisz na firme ze strona -- oznacz jako "Odrzucony" z komentarzem "ma strone".

**Jak czesto pojawiaja sie nowe leady?**
System skanuje codziennie ok. 10:00. Jedna miejscowosc dziennie. Raport Telegram poinformuje cie o nowych leadach.

**Czy moge zmienic status z powrotem?**
Tak. Mozesz zmienic status w dowolnym kierunku. Kazda zmiana jest logowana.

**Zapomnialem token/link do panelu.**
Skontaktuj sie z administratorem.
