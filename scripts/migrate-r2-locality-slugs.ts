/**
 * R2 migration driver for the readable-locality-slugs rollout (#22).
 *
 * Strategy: wrangler CLI has no `r2 object list`, so we avoid listing R2 at
 * all. Instead we derive every live object key from D1 + the manifest:
 *
 *   1. Read `migration-manifest.json` → Map<locality_id, {old_slug, new_slug}>
 *   2. Query D1 for `businesses.site_status = 'done'` → list of (locality_id, biz_slug)
 *   3. For each business, build from/to R2 keys using the manifest's old → new map
 *
 * Drafts are intentionally NOT migrated — they are transient owner-edit state
 * with no D1 column to track them, and the cost of losing them (an owner has
 * to re-start an edit) is low compared to the blast radius of listing R2 via
 * ad-hoc endpoints. A follow-up cleanup task will handle leftover drafts.
 *
 * Idempotent + resumable: each op checks if target already exists; if yes,
 * skips the copy but still deletes the source so the migration converges.
 *
 * Usage:
 *   pnpm tsx scripts/migrate-r2-locality-slugs.ts            # dry run
 *   pnpm tsx scripts/migrate-r2-locality-slugs.ts --apply    # execute
 *   pnpm tsx scripts/migrate-r2-locality-slugs.ts --local    # use local D1+R2
 */

import { execSync } from "node:child_process";
import { slugify } from "../src/lib/slug.js";

const DB_NAME = "leadgen";
const BUCKET = "sites"; // matches wrangler.jsonc r2_buckets[0].bucket_name

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const LOCAL = args.includes("--local");
const ENV_FLAG = LOCAL ? "--local" : "--remote";

interface BizRow {
	biz_slug: string;
	sym: string;
	name: string;
	new_loc_slug: string;
}

interface R2Op {
	biz_slug: string;
	target: string;
	// Candidate sources to probe in order. First hit wins.
	sources: string[];
}

function d1Json<T>(sql: string): T[] {
	const escaped = sql.replace(/'/g, "'\\''");
	const raw = execSync(
		`pnpm wrangler d1 execute ${DB_NAME} ${ENV_FLAG} --yes --json --command='${escaped}'`,
		{ encoding: "utf-8", maxBuffer: 200 * 1024 * 1024 },
	);
	const match = raw.match(/\[[\s\S]*\]/);
	if (!match) return [];
	const parsed = JSON.parse(match[0]);
	if (Array.isArray(parsed) && parsed[0]?.results) {
		return parsed[0].results as T[];
	}
	return parsed as T[];
}

function r2Head(key: string): boolean {
	try {
		execSync(
			`pnpm wrangler r2 object get ${BUCKET}/${key} ${ENV_FLAG} --pipe > /dev/null 2>&1`,
			{ stdio: ["pipe", "pipe", "pipe"] },
		);
		return true;
	} catch {
		return false;
	}
}

function r2Copy(from: string, to: string): void {
	const tmp = `/tmp/r2-mig-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	execSync(
		`pnpm wrangler r2 object get ${BUCKET}/${from} ${ENV_FLAG} --pipe > ${tmp}`,
		{ stdio: ["pipe", "pipe", "inherit"], shell: "/bin/bash" },
	);
	execSync(
		`pnpm wrangler r2 object put ${BUCKET}/${to} ${ENV_FLAG} --file=${tmp} --content-type application/json`,
		{ stdio: ["pipe", "pipe", "inherit"] },
	);
	execSync(`rm -f ${tmp}`);
}

function r2Delete(key: string): void {
	execSync(`pnpm wrangler r2 object delete ${BUCKET}/${key} ${ENV_FLAG}`, {
		stdio: ["pipe", "pipe", "inherit"],
	});
}

async function main() {
	console.log(
		`Loading businesses with site_status='done' from D1 (${ENV_FLAG})...`,
	);
	// We no longer consume the manifest — the current D1 slug IS the target,
	// and we probe multiple historical formats as source candidates because
	// prod R2 was generated at different points during the slug refactor.
	const businesses = d1Json<BizRow>(
		"SELECT b.slug AS biz_slug, l.sym, l.name, l.slug AS new_loc_slug " +
			"FROM businesses b JOIN localities l ON b.locality_id = l.id " +
			"WHERE b.site_status = 'done' ORDER BY b.id",
	);
	console.log(`  ${businesses.length} generated businesses`);

	const ops: R2Op[] = [];
	for (const b of businesses) {
		const bare = slugify(b.name);
		const legacy = `${bare}-${b.sym}`; // pre-Phase-1 `-{sym}` format
		const target = `sites/${b.new_loc_slug}/${b.biz_slug}.json`;

		// Candidate sources in probe order:
		//   1. current-D1 slug (target itself — already migrated or never needed)
		//   2. Phase-1 intermediate: bare slugify(name) without any suffix
		//   3. Pre-Phase-1 legacy: slugify(name)-{sym}
		// De-dupe while preserving order.
		const sources = Array.from(
			new Set([
				target, // already-done check handled by "target exists" branch
				`sites/${bare}/${b.biz_slug}.json`,
				`sites/${legacy}/${b.biz_slug}.json`,
			]),
		);
		ops.push({ biz_slug: b.biz_slug, target, sources });
	}

	console.log(`Plan: ${ops.length} businesses to reconcile`);

	if (ops.length === 0) {
		console.log("Nothing to do.");
		return;
	}

	if (!APPLY) {
		console.log("\nDry run. Re-run with --apply to execute.");
		console.log("First 5 ops (candidate sources in probe order):");
		for (const op of ops.slice(0, 5)) {
			console.log(`  target: ${op.target}`);
			for (const s of op.sources) console.log(`    source? ${s}`);
		}
		console.log(
			"\nNOTE: drafts under sites/draft/ are NOT migrated by this script.",
		);
		console.log(
			"      They are transient owner-edit state; losing them is acceptable.",
		);
		console.log("      Track cleanup via a follow-up issue if needed.");
		return;
	}

	let alreadyDone = 0;
	let copied = 0;
	let notFound = 0;
	let legacyDeleted = 0;
	let i = 0;
	for (const op of ops) {
		i++;
		if (i % 25 === 0 || i === ops.length) {
			console.log(
				`  progress: ${i}/${ops.length} (already=${alreadyDone} copied=${copied} notFound=${notFound} legacyDel=${legacyDeleted})`,
			);
		}

		// 1. If target already exists, this biz is done. Still need to delete
		//    any stale legacy sources so R2 is clean.
		const targetExists = r2Head(op.target);

		// 2. Find the first real source candidate that exists (other than target).
		let sourceKey: string | null = null;
		for (const candidate of op.sources) {
			if (candidate === op.target) continue;
			if (r2Head(candidate)) {
				sourceKey = candidate;
				break;
			}
		}

		if (targetExists) {
			alreadyDone++;
			// Cleanup: if a legacy source still exists under a different key, delete it.
			if (sourceKey && sourceKey !== op.target) {
				try {
					r2Delete(sourceKey);
					legacyDeleted++;
				} catch (e) {
					console.warn(
						`  WARN: legacy delete failed for ${sourceKey}: ${(e as Error).message}`,
					);
				}
			}
			continue;
		}

		if (!sourceKey) {
			notFound++;
			console.warn(
				`  WARN: no source found for ${op.target} (tried: ${op.sources.join(", ")})`,
			);
			continue;
		}

		try {
			r2Copy(sourceKey, op.target);
			copied++;
		} catch (e) {
			console.warn(
				`  WARN: copy failed for ${sourceKey} → ${op.target}: ${(e as Error).message}`,
			);
			continue;
		}
		try {
			r2Delete(sourceKey);
			legacyDeleted++;
		} catch (e) {
			console.warn(
				`  WARN: delete failed for ${sourceKey}: ${(e as Error).message}`,
			);
		}
	}
	console.log(
		`\nDone. already=${alreadyDone} copied=${copied} legacyDeleted=${legacyDeleted} notFound=${notFound}`,
	);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
