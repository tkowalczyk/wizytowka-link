# DD-002a: TERYT CSV Parsing + TERC Enrichment

## Przegląd

Parsowanie SIMC/TERC CSV, wzbogacenie o nazwy administracyjne z TERC, generacja unikalnych slugow, output: batch SQL files. Czysta transformacja danych — bez D1, bez stanu, bez side-effects.

## Cele / Nie-cele

**Cele:**
- Parsowanie SIMC CSV (~95k wierszy) do typowanych obiektow
- Parsowanie TERC CSV do map lookup (woj/pow/gmi)
- Wzbogacenie SIMC o nazwy z TERC
- Generacja globalnie unikalnych slugow
- Generacja INSERT SQL w batchach

**Nie-cele:**
- Egzekucja SQL (DD-002b)
- Zarzadzanie stanem/resume (DD-002b)
- Aktualizacja danych (jednorazowy seed)

## Typy

```ts
interface SimcRow {
  woj: string;
  pow: string;
  gmi: string;
  rodzGmi: string;
  rm: string;
  mz: string;
  nazwa: string;
  sym: string;
  symPod: string;
  stanNa: string;
}

interface TercRow {
  woj: string;
  pow: string;
  gmi: string;
  rodzGmi: string;
  nazwa: string;
}

interface LocalityInsert {
  name: string;
  slug: string;
  sym: string;
  symPod: string;
  woj: string;
  wojName: string;
  pow: string;
  powName: string;
  gmi: string;
  gmiName: string;
}
```

## Parsowanie CSV

```ts
// eTERYT eksportuje CSV jako Windows-1250 — konwersja przed uzyciem:
//   iconv -f WINDOWS-1250 -t UTF-8 simc.csv > simc-utf8.csv
// Skrypt waliduje encoding na starcie.

function assertUtf8(path: string): void {
  const buf = readFileSync(path);
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    throw new Error(
      `${path} nie jest UTF-8 (prawdopodobnie Windows-1250). ` +
      `Konwertuj: iconv -f WINDOWS-1250 -t UTF-8 ${path} > ${path}.tmp && mv ${path}.tmp ${path}`
    );
  }
}

function parseSimcCsv(): SimcRow[] {
  assertUtf8(SIMC_PATH);
  const raw = readFileSync(SIMC_PATH, "utf-8");
  const lines = raw.split("\n").slice(1).filter(Boolean);
  return lines.map((line) => {
    const [woj, pow, gmi, rodzGmi, rm, mz, nazwa, sym, symPod, stanNa] =
      line.split(";");
    return { woj, pow, gmi, rodzGmi, rm, mz, nazwa, sym, symPod, stanNa };
  });
}

function parseTercCsv(): TercRow[] {
  assertUtf8(TERC_PATH);
  const raw = readFileSync(TERC_PATH, "utf-8");
  const lines = raw.split("\n").slice(1).filter(Boolean);
  // TERC CSV: WOJ;POW;GMI;RODZ_GMI;NAZWA;NAZWA_DOD;STAN_NA (7 kolumn)
  // Uzywamy 5 pierwszych, NAZWA_DOD i STAN_NA ignorowane
  return lines.map((line, idx) => {
    const cols = line.split(";");
    if (cols.length < 5) {
      console.warn(`TERC line ${idx + 2}: expected >=5 cols, got ${cols.length}, skipping`);
      return null;
    }
    return {
      woj: cols[0],
      pow: cols[1],
      gmi: cols[2],
      rodzGmi: cols[3],
      nazwa: cols[4],
    };
  }).filter((r): r is TercRow => r !== null);
}
```

Kolumny SIMC: `WOJ;POW;GMI;RODZ_GMI;RM;MZ;NAZWA;SYM;SYMPOD;STAN_NA`

## TERC Lookup

```ts
// Buduje mapy: woj→nazwa, woj+pow→nazwa, woj+pow+gmi+rodzGmi→nazwa
function buildTercMaps(terc: TercRow[]) {
  const wojMap = new Map<string, string>();
  const powMap = new Map<string, string>();
  const gmiMap = new Map<string, string>();

  for (const r of terc) {
    if (r.pow === "" && r.gmi === "") {
      wojMap.set(r.woj, r.nazwa);
    } else if (r.gmi === "" || r.gmi === undefined) {
      powMap.set(`${r.woj}-${r.pow}`, r.nazwa);
    } else {
      gmiMap.set(`${r.woj}-${r.pow}-${r.gmi}-${r.rodzGmi}`, r.nazwa);
    }
  }

  return { wojMap, powMap, gmiMap };
}
```

Hierarchia TERC: pusty POW/GMI = wojewodztwo, pusty GMI = powiat, pelny = gmina.

## Enrichment + Slug Generation

```ts
// Global slug tracker — initialized ONCE before WOJ loop
const globalSlugs = new Set<string>();

function enrichRows(
  rows: SimcRow[],
  tercMaps: ReturnType<typeof buildTercMaps>
): LocalityInsert[] {
  const { wojMap, powMap, gmiMap } = tercMaps;

  return rows.map((r) => {
    let slug = slugify(r.nazwa);
    if (globalSlugs.has(slug)) slug = `${slug}-${r.sym}`;
    globalSlugs.add(slug);

    return {
      name: r.nazwa,
      slug,
      sym: r.sym,
      symPod: r.symPod,
      woj: r.woj,
      wojName: wojMap.get(r.woj) ?? "",
      pow: r.pow,
      powName: powMap.get(`${r.woj}-${r.pow}`) ?? "",
      gmi: r.gmi,
      gmiName: gmiMap.get(`${r.woj}-${r.pow}-${r.gmi}-${r.rodzGmi}`) ?? "",
    };
  });
}
```

Slug strategy: global `Set<string>` across all WOJ. On collision, append `-{sym}` (SIMC symbol, unique per locality). `sym` is UNIQUE in DB so suffix guaranteed unique.

`slugify` imported from `src/lib/slug.ts` (kanoniczny, patrz DD-004):

```ts
import { slugify } from '../src/lib/slug';
```

## Generacja SQL

```ts
function generateInsertSql(batch: LocalityInsert[]): string {
  const values = batch
    .map(
      (l) =>
        `('${esc(l.name)}','${esc(l.slug)}','${l.sym}','${l.symPod}','${l.woj}','${esc(l.wojName)}','${l.pow}','${esc(l.powName)}','${l.gmi}','${esc(l.gmiName)}')`
    )
    .join(",\n");

  return `INSERT OR IGNORE INTO localities (name, slug, sym, sym_pod, woj, woj_name, pow, pow_name, gmi, gmi_name)
VALUES
${values};`;
}

function esc(s: string): string {
  return s
    .replace(/'/g, "''")
    .replace(/\0/g, '');
}
```

D1 limit: max 100 wierszy per INSERT, max 100KB per statement. 100 rows * ~200B = ~20KB — safe.

`INSERT OR IGNORE` — UNIQUE constraint on `sym`/`slug` prevents dupes on partial WOJ failure retry.

## Dane TERC

Plik `data/terc.csv` — pobrany recznie z eTERYT. Format (separator `;`):

```
WOJ;POW;GMI;RODZ_GMI;NAZWA;NAZWA_DOD;STAN_NA
02;;;;DOLNOSLASKIE;wojewodztwo;2026-01-01
02;01;;;boleslawicki;powiat;2026-01-01
02;01;01;1;Boleslawiec;gmina miejska;2026-01-01
```

Eksport z eTERYT = Windows-1250 — konwersja wymagana: `iconv -f WINDOWS-1250 -t UTF-8 terc.csv > terc-utf8.csv`.

## Weryfikacja

| Check | Jak |
|-------|-----|
| SIMC CSV exists + UTF-8 | `assertUtf8("data/simc.csv")` nie rzuca |
| TERC CSV exists + UTF-8 | `assertUtf8("data/terc.csv")` nie rzuca |
| Parsing produces correct row count | `parseSimcCsv().length` ~95100 |
| TERC enrichment works | `enrichRows` result has non-empty `wojName`/`powName`/`gmiName` |
| Slugs are unique | `globalSlugs.size === total rows` (no silent overwrites) |
| SQL generation correct | Manual inspection of 1 batch file: valid SQL, correct escaping |

## Referencje

- [TERYT SIMC/TERC download](https://eteryt.stat.gov.pl/eTeryt/rejestr_teryt/udostepnianie_danych/baza_teryt/uzytkownicy_indywidualni/pobieranie/pobieranie.aspx)
- DD-001: D1 Schema
- DD-002: TERYT SIMC Seed (original, combined doc)
- DD-004: `slugify` kanoniczny

## Decyzje

- **`esc()` — SQLite only needs `''` for quotes**. No backslash escaping.
- **TERC bounds check**: `cols.length < 5` guard with warning, skips corrupted rows.
- **`assertUtf8()` uses `TextDecoder('utf-8', { fatal: true })`** — reliable BOM-agnostic detection.
- **RM/MZ** — ladujemy wszystkie typy. Wiecej pokrycia = wiecej leadow.
- **simc.csv** — zweryfikowany: UTF-8, separator `;`, 10 kolumn.
- **terc.csv** — eksport Windows-1250, konwersja wymagana. Skrypt waliduje i rzuca czytelny blad.
- **UNIQUE** — `slug` UNIQUE + `sym` UNIQUE. `INSERT OR IGNORE` keys off oba.
- **Slug globalnie unikalny** — URL `/{loc_slug}/{biz_slug}` wymaga. Collision resolved with `-{sym}` suffix.
