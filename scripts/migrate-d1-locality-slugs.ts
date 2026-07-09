/**
 * D1 migration driver for the readable-locality-slugs rollout (#22).
 *
 * Reads all rows from `localities` on production D1 via `wrangler d1 execute`,
 * computes the new slugs via `assignLocalitySlugs` (the source of truth from
 * Phases 1+2), groups rows that need updating into batches respecting D1's
 * 100-param ceiling, then executes them sequentially.
 *
 * Idempotent: a second run after the first one is a no-op.
 *
 * Side artifact: writes `migration-manifest.json` with `{id, old_slug, new_slug}`
 * for every row that changed BEFORE executing UPDATEs. The R2 migration
 * driver consumes this manifest as the bridge between D1 and R2 — without it
 * R2 would not know which old → new slug mapping to apply once D1 is updated.
 *
 * Usage:
 *   pnpm tsx scripts/migrate-d1-locality-slugs.ts            # writes manifest, prints plan, asks confirm
 *   pnpm tsx scripts/migrate-d1-locality-slugs.ts --apply    # actually executes
 *   pnpm tsx scripts/migrate-d1-locality-slugs.ts --local    # use local D1 instead of remote
 */

import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	batchD1Updates,
	batchHistoryInserts,
	type LocalityRow,
	planD1Migration,
} from "../src/lib/migrations/locality-slug-d1.js";

const DB_NAME = "leadgen";
const MANIFEST_PATH = resolve(process.cwd(), "migration-manifest.json");

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const LOCAL = args.includes("--local");
const ENV_FLAG = LOCAL ? "--local" : "--remote";

function d1Raw(sql: string): string {
	const escaped = sql.replace(/'/g, "'\\''");
	return execSync(
		`pnpm wrangler d1 execute ${DB_NAME} ${ENV_FLAG} --yes --json --command='${escaped}'`,
		{ encoding: "utf-8", maxBuffer: 50 * 1024 * 1024 },
	);
}

function d1Json<T>(sql: string): T[] {
	const raw = d1Raw(sql);
	const match = raw.match(/\[[\s\S]*\]/);
	if (!match) return [];
	const parsed = JSON.parse(match[0]);
	if (Array.isArray(parsed) && parsed[0]?.results) {
		return parsed[0].results as T[];
	}
	return parsed as T[];
}

function execBatch(sql: string, params: (number | string)[]): void {
	// `wrangler d1 execute` does not bind params via CLI, so we inline them.
	// Replace placeholders right-to-left to avoid prefix collisions (?1 vs ?10).
	let inlined = sql;
	for (let i = params.length; i >= 1; i--) {
		const p = params[i - 1];
		const lit =
			typeof p === "number" ? String(p) : `'${String(p).replace(/'/g, "''")}'`;
		inlined = inlined.split(`?${i}`).join(lit);
	}
	d1Raw(inlined);
}

async function main() {
	console.log(`Loading localities from D1 (${ENV_FLAG})...`);
	const rows = d1Json<LocalityRow>(
		"SELECT l.id, l.slug AS current_slug, l.name, l.gmi_name, l.pow_name, l.woj_name, l.sym, " +
			"EXISTS(SELECT 1 FROM businesses b WHERE b.locality_id = l.id AND b.site_status = 'done') AS frozen " +
			"FROM localities l ORDER BY l.id",
	);
	console.log(`  ${rows.length} rows`);

	console.log("Computing migration plan...");
	const plan = planD1Migration(rows);
	console.log(
		`  unchanged: ${plan.unchangedCount}, updates: ${plan.updates.length}`,
	);

	if (plan.updates.length === 0) {
		console.log("Nothing to do. D1 is already on the new slug format.");
		return;
	}

	// Build manifest by joining updates with their old slugs from `rows`.
	const oldSlugById = new Map(rows.map((r) => [r.id, r.current_slug]));
	const manifest = plan.updates.map((u) => ({
		id: u.id,
		old_slug: oldSlugById.get(u.id) ?? "",
		new_slug: u.new_slug,
	}));
	writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
	console.log(`Manifest written to ${MANIFEST_PATH}`);

	const batches = batchD1Updates(plan.updates);
	console.log(`Plan: ${batches.length} D1 batches.`);

	if (!APPLY) {
		console.log("\nDry run. Re-run with --apply to execute.");
		return;
	}

	// Record history rows BEFORE rewriting slugs so a crash never loses the
	// old→new mapping; INSERT OR IGNORE keeps this idempotent across re-runs (#83).
	const historyBatches = batchHistoryInserts(plan.updates);
	console.log(`Recording ${plan.updates.length} slug-history rows...`);
	let h = 0;
	for (const b of historyBatches) {
		h++;
		console.log(
			`  history batch ${h}/${historyBatches.length} (${b.params.length} params)`,
		);
		execBatch(b.sql, b.params);
	}

	console.log("Applying batches...");
	let n = 0;
	for (const b of batches) {
		n++;
		console.log(`  batch ${n}/${batches.length} (${b.params.length} params)`);
		execBatch(b.sql, b.params);
	}
	console.log("Done.");
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
