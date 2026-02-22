import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { slugify } from "../src/lib/slug.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SIMC_PATH = resolve(ROOT, "data/simc.csv");
const TERC_PATH = resolve(ROOT, "data/terc.csv");
const SQL_DIR = resolve(ROOT, "data/sql");

const BATCH_SIZE = 100;

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

// --- Main ---

function main() {
  console.log("Parsing SIMC CSV...");
  const simc = parseSimcCsv();
  console.log(`  ${simc.length} rows`);

  console.log("Parsing TERC CSV...");
  const terc = parseTercCsv();
  console.log(`  ${terc.length} rows`);

  console.log("Building TERC lookup maps...");
  const tercMaps = buildTercMaps(terc);
  console.log(
    `  woj=${tercMaps.wojMap.size} pow=${tercMaps.powMap.size} gmi=${tercMaps.gmiMap.size}`
  );

  const mainOnly = simc.filter(r => r.sym === r.symPod);
  console.log(`  ${mainOnly.length} MAIN rows (filtered ${simc.length - mainOnly.length} SUB)`);

  console.log("Enriching SIMC rows...");
  const localities = enrichRows(mainOnly, tercMaps);
  console.log(`  ${localities.length} localities, ${globalSlugs.size} unique slugs`);

  if (localities.length !== globalSlugs.size) {
    console.error("WARN: slug count mismatch — possible silent overwrite");
  }

  if (!existsSync(SQL_DIR)) mkdirSync(SQL_DIR, { recursive: true });

  console.log(`Generating SQL batches (${BATCH_SIZE} rows each)...`);
  const totalBatches = Math.ceil(localities.length / BATCH_SIZE);
  for (let i = 0; i < localities.length; i += BATCH_SIZE) {
    const batch = localities.slice(i, i + BATCH_SIZE);
    const sql = generateInsertSql(batch);
    const batchNum = String(Math.floor(i / BATCH_SIZE) + 1).padStart(4, "0");
    writeFileSync(resolve(SQL_DIR, `${batchNum}.sql`), sql, "utf-8");
  }

  console.log(`Done. ${totalBatches} SQL files written to data/sql/`);
}

main();
