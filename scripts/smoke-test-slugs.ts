/**
 * Production smoke test for the readable-locality-slugs rollout (#22).
 *
 * Picks 10 random businesses from production D1 — biased toward a mix of
 * colliding and unique localities — and for each one:
 *   1. GETs the new URL `${BASE}/{locality_slug}/{business_slug}` → expects 200
 *   2. Asserts the response body contains the full locality label
 *      `Name, gm. Gmina, pow. powiat` (the L1 source of truth from
 *      `formatLocalityLabel`)
 *   3. GETs the legacy `-{sym}` URL → expects 404
 *
 * Targets production by default. Override with `--base-url=https://...`.
 *
 * Usage:
 *   pnpm tsx scripts/smoke-test-slugs.ts
 *   pnpm tsx scripts/smoke-test-slugs.ts --base-url=https://wizytowka.link
 */

import { execSync } from "node:child_process";
import { formatLocalityLabel } from "../src/lib/locality-label.js";

const DB_NAME = "leadgen";
const args = process.argv.slice(2);
const baseArg = args.find((a) => a.startsWith("--base-url="));
const BASE = (
	baseArg ? baseArg.slice("--base-url=".length) : "https://wizytowka.link"
).replace(/\/$/, "");

interface SampleRow {
	biz_slug: string;
	loc_slug: string;
	loc_name: string;
	gmi_name: string;
	pow_name: string;
	sym: string;
	collision_group: number;
}

function d1Json<T>(sql: string): T[] {
	const escaped = sql.replace(/'/g, "'\\''");
	const raw = execSync(
		`pnpm wrangler d1 execute ${DB_NAME} --remote --yes --json --command='${escaped}'`,
		{ encoding: "utf-8", maxBuffer: 50 * 1024 * 1024 },
	);
	const match = raw.match(/\[[\s\S]*\]/);
	if (!match) return [];
	const parsed = JSON.parse(match[0]);
	if (Array.isArray(parsed) && parsed[0]?.results) {
		return parsed[0].results as T[];
	}
	return parsed as T[];
}

function legacySlug(loc: SampleRow): string {
	// The pre-migration form was `slugify(name)-{sym}`, but on prod we don't
	// have access to the old slug post-migration. The most reliable cross-
	// check is: the locality slug minus the disambiguator. We use the bare
	// `slugify(name)` form as the legacy guess — for any locality that did
	// escalate, that bare form must now be a 404 because no other locality
	// claimed it. We slug-ify in the same way as src/lib/slug.ts.
	return loc.loc_name
		.toLowerCase()
		.replace(/ą/g, "a")
		.replace(/ć/g, "c")
		.replace(/ę/g, "e")
		.replace(/ł/g, "l")
		.replace(/ń/g, "n")
		.replace(/ó/g, "o")
		.replace(/ś/g, "s")
		.replace(/ź/g, "z")
		.replace(/ż/g, "z")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

async function main() {
	console.log(`Smoke test against ${BASE}`);
	console.log(
		"Sampling 10 businesses (mix of unique + colliding localities)...",
	);

	// Pick 5 from localities whose name appears more than once (collisions),
	// and 5 from singleton-name localities. Both must be reachable.
	const sample = d1Json<SampleRow>(`
		WITH name_counts AS (
			SELECT name, COUNT(*) AS c FROM localities GROUP BY name
		),
		collisions AS (
			SELECT b.slug AS biz_slug, l.slug AS loc_slug, l.name AS loc_name,
			       l.gmi_name, l.pow_name, l.sym, 1 AS collision_group
			FROM businesses b
			JOIN localities l ON b.locality_id = l.id
			JOIN name_counts nc ON nc.name = l.name
			WHERE nc.c > 1 AND b.site_status = 'done'
			ORDER BY RANDOM() LIMIT 5
		),
		uniques AS (
			SELECT b.slug AS biz_slug, l.slug AS loc_slug, l.name AS loc_name,
			       l.gmi_name, l.pow_name, l.sym, 0 AS collision_group
			FROM businesses b
			JOIN localities l ON b.locality_id = l.id
			JOIN name_counts nc ON nc.name = l.name
			WHERE nc.c = 1 AND b.site_status = 'done'
			ORDER BY RANDOM() LIMIT 5
		)
		SELECT * FROM collisions UNION ALL SELECT * FROM uniques
	`);

	console.log(`  ${sample.length} businesses sampled\n`);
	if (sample.length === 0) {
		console.error("FAIL: no businesses returned from D1 sample query");
		process.exit(1);
	}

	let passed = 0;
	let failed = 0;

	for (const row of sample) {
		const url = `${BASE}/${row.loc_slug}/${row.biz_slug}`;
		const expectedLabel = formatLocalityLabel({
			name: row.loc_name,
			gmi_name: row.gmi_name,
			pow_name: row.pow_name,
		});
		const tag = row.collision_group === 1 ? "[collision]" : "[unique    ]";

		try {
			const res = await fetch(url);
			if (res.status !== 200) {
				console.error(`  FAIL ${tag} ${url} → ${res.status}`);
				failed++;
				continue;
			}
			const body = await res.text();
			if (!body.includes(expectedLabel)) {
				console.error(
					`  FAIL ${tag} ${url} → 200 but missing label "${expectedLabel}"`,
				);
				failed++;
				continue;
			}

			// Check legacy URL form returns 404 — only meaningful when bare-slug
			// differs from the actual loc_slug (i.e. the locality DID escalate).
			const legacy = legacySlug(row);
			if (legacy !== row.loc_slug) {
				const legacyUrl = `${BASE}/${legacy}/${row.biz_slug}`;
				const legacyRes = await fetch(legacyUrl);
				if (legacyRes.status !== 404) {
					console.error(
						`  FAIL ${tag} legacy URL ${legacyUrl} → ${legacyRes.status} (expected 404)`,
					);
					failed++;
					continue;
				}
			}

			console.log(`  PASS ${tag} ${url}`);
			passed++;
		} catch (e) {
			console.error(`  ERROR ${tag} ${url} → ${(e as Error).message}`);
			failed++;
		}
	}

	console.log(`\nResult: ${passed}/${sample.length} passed, ${failed} failed`);
	if (failed > 0) process.exit(1);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
