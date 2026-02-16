import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";
import * as readline from "node:readline";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { slugify } from "../src/lib/slug.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SIMC_PATH = resolve(ROOT, "data/simc.csv");
const TERC_PATH = resolve(ROOT, "data/terc.csv");
const STATE_PATH = resolve(ROOT, "scripts/.seed-state.json");
const BATCH_SIZE = 100;
const WOJ_CODES = [
  "02", "04", "06", "08", "10", "12",
  "14", "16", "18", "20", "22", "24",
  "26", "28", "30", "32",
];

// --- Types ---

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

interface SeedState {
  completedWoj: string[];
  totalInserted: number;
  startedAt: string;
}

interface D1QueryResult {
  results: { slug: string }[];
}

// --- UTF-8 Validation ---

function assertUtf8(path: string): void {
  const buf = readFileSync(path);
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    throw new Error(
      `${path} nie jest UTF-8 (prawdopodobnie Windows-1250). ` +
        `Konwertuj: iconv -f WINDOWS-1250 -t UTF-8 ${path} > ${path}.tmp && mv ${path}.tmp ${path}`
    );
  }
}

// --- CSV Parsing ---

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
  return lines
    .map((line, idx) => {
      const cols = line.split(";");
      if (cols.length < 5) {
        console.warn(
          `TERC line ${idx + 2}: expected >=5 cols, got ${cols.length}, skipping`
        );
        return null;
      }
      return {
        woj: cols[0],
        pow: cols[1],
        gmi: cols[2],
        rodzGmi: cols[3],
        nazwa: cols[4],
      };
    })
    .filter((r): r is TercRow => r !== null);
}

// --- TERC Lookup Maps ---

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

// --- Enrichment + Slug Generation ---

const globalSlugs = new Set<string>();

function enrichRows(
  rows: SimcRow[],
  tercMaps: ReturnType<typeof buildTercMaps>
): LocalityInsert[] {
  const { wojMap, powMap, gmiMap } = tercMaps;

  return rows.map((r) => {
    const wojName = wojMap.get(r.woj) ?? "";
    const powName = powMap.get(`${r.woj}-${r.pow}`) ?? "";
    const gmiName = gmiMap.get(`${r.woj}-${r.pow}-${r.gmi}-${r.rodzGmi}`) ?? "";

    if (!wojName) console.warn(`TERC miss: woj=${r.woj} for ${r.nazwa} (sym=${r.sym})`);

    let slug = slugify(r.nazwa);
    if (globalSlugs.has(slug)) slug = `${slug}-${r.sym}`;
    globalSlugs.add(slug);

    return {
      name: r.nazwa,
      slug,
      sym: r.sym,
      symPod: r.symPod,
      woj: r.woj,
      wojName,
      pow: r.pow,
      powName,
      gmi: r.gmi,
      gmiName,
    };
  });
}

// --- SQL Generation ---

function esc(s: string): string {
  return s.replace(/'/g, "''").replace(/\0/g, "");
}

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

// --- Batch Helpers ---

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

// --- State Management ---

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

// --- Resume: rebuild slugs from CSV for completed WOJs ---

function rebuildSlugsForCompletedWoj(
  simc: SimcRow[],
  completedWoj: string[]
): void {
  const completed = new Set(completedWoj);
  for (const r of simc) {
    if (!completed.has(r.woj)) continue;
    let slug = slugify(r.nazwa);
    if (globalSlugs.has(slug)) slug = `${slug}-${r.sym}`;
    globalSlugs.add(slug);
  }
}

// --- Interactive Prompt ---

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

// --- Main ---

async function main() {
  const simc = parseSimcCsv();
  const terc = parseTercCsv();
  const tercMaps = buildTercMaps(terc);
  const state = loadState();

  console.log(`Zaladowano ${simc.length} wierszy SIMC`);
  console.log(`Stan: ${state.completedWoj.length}/16 woj, ${state.totalInserted} wstawionych`);

  if (state.completedWoj.length > 0) {
    console.log("Odbudowa slugow z CSV dla ukonczonych WOJ...");
    rebuildSlugsForCompletedWoj(simc, state.completedWoj);
    console.log(`  ${globalSlugs.size} slugow odbudowanych`);
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
      const file = resolve(ROOT, `scripts/localities-batch-${woj}-${i}.sql`);
      writeFileSync(file, sql);
      execSync(`pnpm wrangler d1 execute leadgen --remote --yes --file=${file}`, {
        stdio: "inherit",
      });
      unlinkSync(file);
      process.stdout.write(`  batch ${i + 1}/${batches.length}\r`);
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

main();
