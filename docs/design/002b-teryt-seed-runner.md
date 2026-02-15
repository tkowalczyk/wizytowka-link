# DD-002b: TERYT Batch Seed Script + Resume

## Przegląd

Skrypt seedujacy ~95k miejscowosci do D1 `localities`. Wznawialny, etapowy (per-WOJ), interaktywny. Uzywa parsowania/enrichmentu z DD-002a. Ten dokument opisuje orkiestracje: batch execution, state management, resume, error handling.

## Cele / Nie-cele

**Cele:**
- Wykonac batch INSERT SQL do D1 per wojewodztwo (16 etapow)
- Wznawialna egzekucja z interaktywnym promptem
- Zarzadzanie stanem (`seed/.seed-state.json`)
- Obsluga bledow (partial WOJ failure)

**Nie-cele:**
- Parsowanie CSV / enrichment (DD-002a)
- Aktualizacja danych (jednorazowy seed)
- Geocoding (Etap 3)

## Architektura

```
data/simc.csv ──┐
                ├──> seed/parse-simc.ts ──> seed/localities-batch-{WOJ}-{N}.sql
data/terc.csv ──┘                                      │
                                                       ▼
                                            wrangler d1 execute
                                                       │
                                                       ▼
                                               D1 localities
                                                       │
seed/.seed-state.json  <───────────────────────────────┘
```

### Flow etapowy

```
START
  │
  ▼
Odczytaj .seed-state.json (lub stworz domyslny)
  │
  ▼
Dla kazdego WOJ (02..32, 16 sztuk):
  │
  ├─ Czy WOJ juz w completedWoj? → SKIP
  │
  ├─ Filtruj wiersze SIMC dla tego WOJ
  │
  ├─ Wzbogac o nazwy z TERC (DD-002a: enrichRows)
  │
  ├─ Generuj slugi (DD-002a: globalSlugs)
  │
  ├─ Podziel na batche po 100 wierszy
  │
  ├─ Zapisz batch SQL → seed/localities-batch-{WOJ}-{N}.sql
  │
  ├─ Wykonaj kazdy batch: wrangler d1 execute leadgen --file=...
  │
  ├─ Zapisz stan: dodaj WOJ do completedWoj
  │
  ├─ Wydrukuj podsumowanie
  │
  └─ Prompt: "Kontynuowac? (t/n)" → jesli 'n', EXIT
  │
  ▼
DONE — usun .seed-state.json
```

## Typy

```ts
interface SeedState {
  completedWoj: string[];
  totalInserted: number;
  startedAt: string;
}
```

## Main Function

```ts
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { execSync } from "child_process";
import * as readline from "readline";

const SIMC_PATH = "data/simc.csv";
const TERC_PATH = "data/terc.csv";
const STATE_PATH = "seed/.seed-state.json";
const BATCH_SIZE = 100;
const WOJ_CODES = [
  "02", "04", "06", "08", "10", "12",
  "14", "16", "18", "20", "22", "24",
  "26", "28", "30", "32",
];

async function main() {
  const simc = parseSimcCsv();
  const terc = parseTercCsv();
  const tercMaps = buildTercMaps(terc);
  const state = loadState();

  console.log(`Zaladowano ${simc.length} wierszy SIMC`);
  console.log(`Stan: ${state.completedWoj.length}/16 woj, ${state.totalInserted} wstawionych`);

  // Rebuild globalSlugs from DB on resume
  if (state.completedWoj.length > 0) {
    for (const slug of loadExistingSlugs()) {
      globalSlugs.add(slug);
    }
  }

  for (const woj of WOJ_CODES) {
    if (state.completedWoj.includes(woj)) {
      console.log(`WOJ ${woj}: SKIP (juz zaladowany)`);
      continue;
    }

    const rows = simc.filter((r) => r.woj === woj);
    const localities = enrichRows(rows, tercMaps);
    const batches = chunk(localities, BATCH_SIZE);

    console.log(`\nWOJ ${woj}: ${rows.length} miejscowosci, ${batches.length} batchy`);

    for (let i = 0; i < batches.length; i++) {
      const sql = generateInsertSql(batches[i]);
      const file = `seed/localities-batch-${woj}-${i}.sql`;
      writeFileSync(file, sql);
      execSync(`wrangler d1 execute leadgen --file=./${file}`, {
        stdio: "inherit",
      });
      unlinkSync(file);
    }

    state.completedWoj.push(woj);
    state.totalInserted += rows.length;
    saveState(state);

    console.log(`WOJ ${woj}: DONE (total: ${state.totalInserted})`);

    if (woj !== WOJ_CODES[WOJ_CODES.length - 1]) {
      const cont = await askContinue();
      if (!cont) {
        console.log("Zatrzymano. Uruchom ponownie aby kontynuowac.");
        return;
      }
    }
  }

  unlinkSync(STATE_PATH);
  console.log(`\nSeed zakonczony. Wstawiono ${state.totalInserted} miejscowosci.`);
}
```

## State Management

```ts
function loadState(): SeedState {
  if (existsSync(STATE_PATH)) {
    return JSON.parse(readFileSync(STATE_PATH, "utf-8"));
  }
  return {
    completedWoj: [],
    totalInserted: 0,
    startedAt: new Date().toISOString(),
  };
}

function saveState(state: SeedState): void {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}
```

State file at `seed/.seed-state.json`:
```json
{
  "completedWoj": ["02", "04"],
  "totalInserted": 12450,
  "startedAt": "2026-02-15T10:00:00Z"
}
```

**Why state file over DB-check**: faster (no extra D1 queries), deterministic, displayable to user.

## Batch Execution

```ts
function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}
```

Each batch: write SQL file -> `wrangler d1 execute leadgen --file=...` -> delete file.

## Resume Logic

```ts
function loadExistingSlugs(): Set<string> {
  const result = execSync(
    `wrangler d1 execute leadgen --command="SELECT slug FROM localities" --json`,
    { encoding: "utf-8" }
  );
  const parsed = JSON.parse(result);
  return new Set(parsed[0].results.map((r: { slug: string }) => r.slug));
}

// In main(), before WOJ loop:
if (state.completedWoj.length > 0) {
  for (const slug of loadExistingSlugs()) {
    globalSlugs.add(slug);
  }
}
```

On resume, existing slugs loaded from DB into `globalSlugs` Set. `-{sym}` suffix is deterministic — Set membership sufficient for dedup.

## Interactive Prompt

```ts
function askContinue(): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question("Kontynuowac nastepne wojewodztwo? (t/n): ", (ans) => {
      rl.close();
      resolve(ans.trim().toLowerCase() === "t");
    });
  });
}
```

## Error Handling

Jesli `wrangler d1 execute` fails during batch:
1. WOJ NOT added to `completedWoj`
2. State NOT saved for that WOJ
3. User sees error, can retry

Partial WOJ failure: some batches already inserted. Solution: `INSERT OR IGNORE` — UNIQUE constraint on `sym`/`slug` prevents dupes on retry.

```sql
INSERT OR IGNORE INTO localities (name, slug, sym, ...)
VALUES ...;
```

## `package.json` additions

```json
{
  "scripts": {
    "seed:localities": "tsx seed/parse-simc.ts"
  },
  "devDependencies": {
    "tsx": "^4.x"
  }
}
```

Run: `npx tsx seed/parse-simc.ts`

Requirements: `tsx` (TypeScript execution), `wrangler` in PATH.

## Performance

- ~95k rows / 100 per batch = ~950 batches
- 16 WOJ, avg ~60 batches per WOJ
- `wrangler d1 execute` per batch ~1-2s = ~15-30 min total
- Can increase BATCH_SIZE to 500 if D1 100KB limit allows (500 rows * ~200B = ~100KB — borderline)

## File Structure

```
seed/
  parse-simc.ts          # Main script
  .seed-state.json       # Resume state (generated)
  localities-batch-*.sql  # Temp SQL files (deleted after execution)
data/
  simc.csv               # SIMC source
  terc.csv               # TERC source (manual download)
```

## Weryfikacja

| Check | Jak |
|-------|-----|
| Script starts | `npx tsx seed/parse-simc.ts` runs, prints SIMC row count |
| Pause/resume works | Stop after WOJ 06, `.seed-state.json` has `["02","04","06"]`, rerun starts from WOJ 08 |
| Total count ~95100 | `SELECT COUNT(*) FROM localities;` |
| 16 voivodeships | `SELECT DISTINCT woj FROM localities;` → 16 rows |
| No slug dupes | `SELECT slug, COUNT(*) as c FROM localities GROUP BY slug HAVING c > 1;` → 0 rows |
| Test record | `SELECT * FROM localities WHERE name = 'Stanisławów Pierwszy';` → gmina Nieporet, pow legionowski, woj 14 |

## Referencje

- DD-002a: TERYT CSV Parsing + TERC Enrichment
- DD-002: TERYT SIMC Seed (original, combined doc)
- DD-001: D1 Schema
- [D1 import data](https://developers.cloudflare.com/d1/best-practices/import-export-data/)
- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)

## Decyzje

- **State File (Opcja A)** over DB-Check. Faster, deterministic, displayable.
- **INSERT OR IGNORE** — D1 = full SQLite 3.x, wspiera. Keys off `sym` UNIQUE + `slug` UNIQUE.
- **Batch size 100** — safe margin. Optimization later if needed.
- **~95k** — actual row count in `simc.csv`. PLAN.md ~102k was estimate.
- **`tsx` in devDependencies** — added to DD-001 package.json + script section here.

### Open from DD-002 REVIEW

- [ ] **Log TERC enrichment failures**: `wojMap.get(r.woj) ?? ""` silently defaults to empty string. Log warning when TERC lookup fails.
- [ ] **Add progress output**: batch loop shows nothing during execution (~15-30 min). Add per-batch counter log.
